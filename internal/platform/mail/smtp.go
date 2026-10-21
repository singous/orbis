package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net"
	stdmail "net/mail"
	"net/smtp"
	"strings"
	"time"

	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/workspace"
)

type smtpSender struct {
	config  config.Mail
	rootCAs *x509.CertPool
}

func (*smtpSender) Available() bool { return true }

func renderMessage(from string, message workspace.ActionMail) (string, error) {
	address, err := stdmail.ParseAddress(message.Recipient)
	if err != nil || address.Address != message.Recipient {
		return "", ErrDelivery
	}
	subject := "Orbis 工作空间邀请"
	body := fmt.Sprintf("您受邀加入工作空间 %s，角色为 %s。\r\n请打开以下链接接受邀请：\r\n%s\r\n", message.WorkspaceName, message.Role, message.URL)
	if message.Kind == workspace.OwnershipMail {
		subject = "确认 Orbis 所有权转移"
		body = fmt.Sprintf("请确认将工作空间 %s 的所有权转移给 %s。\r\n请打开以下链接确认：\r\n%s\r\n", message.WorkspaceName, message.TargetDisplayName, message.URL)
	}
	businessZone := time.FixedZone("UTC+8", 8*60*60)
	body += fmt.Sprintf("链接到期时间（UTC+8）：%s\r\n", time.UnixMilli(message.ExpiresAtMS).In(businessZone).Format(time.RFC3339))
	encoded := base64.StdEncoding.EncodeToString([]byte(body))
	var output strings.Builder
	fmt.Fprintf(&output, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n",
		from, message.Recipient, mime.QEncoding.Encode("UTF-8", subject))
	for len(encoded) > 0 {
		n := min(76, len(encoded))
		output.WriteString(encoded[:n])
		output.WriteString("\r\n")
		encoded = encoded[n:]
	}
	return output.String(), nil
}

// Send requires verified TLS and closes a blocked SMTP connection when its request is cancelled.
func (s *smtpSender) Send(parent context.Context, message workspace.ActionMail) error {
	ctx, cancel := context.WithTimeout(parent, s.config.Timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.send(ctx, message); err != nil {
		return safeFailure(ctx)
	}
	return nil
}

func (s *smtpSender) send(ctx context.Context, message workspace.ActionMail) error {
	encoded, err := renderMessage(s.config.From, message)
	if err != nil {
		return err
	}
	host, _, err := net.SplitHostPort(s.config.SMTPAddress)
	if err != nil {
		return err
	}
	connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.config.SMTPAddress)
	if err != nil {
		return err
	}
	finished := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { _ = connection.Close(); close(finished) })
	defer func() {
		if !stop() {
			<-finished
		}
		_ = connection.Close()
	}()
	if deadline, ok := ctx.Deadline(); ok {
		if err := connection.SetDeadline(deadline); err != nil {
			return err
		}
	}
	tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12, RootCAs: s.rootCAs}
	var client *smtp.Client
	if s.config.SMTPSecurity == "tls" {
		secure := tls.Client(connection, tlsConfig)
		if err := secure.HandshakeContext(ctx); err != nil {
			return err
		}
		client, err = smtp.NewClient(secure, host)
	} else {
		client, err = smtp.NewClient(connection, host)
		if err == nil {
			err = client.StartTLS(tlsConfig)
		}
	}
	if err != nil {
		return err
	}
	if s.config.SMTPUsername != "" {
		if err := client.Auth(smtp.PlainAuth("", s.config.SMTPUsername, s.config.SMTPPassword, host)); err != nil {
			return err
		}
	}
	if err := client.Mail(s.config.From); err != nil {
		return err
	}
	if err := client.Rcpt(message.Recipient); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := io.WriteString(writer, encoded); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	// DATA acknowledgement establishes delivery; a failed QUIT must not turn it into a retry.
	if err := client.Quit(); err != nil {
		return nil
	}
	return nil
}
