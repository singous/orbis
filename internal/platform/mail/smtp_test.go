package mail

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	stdmail "net/mail"
	"net/textproto"
	"strings"
	"testing"
	"time"

	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/workspace"
)

func testCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"}, IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(certificate)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, roots
}

type smtpResult struct {
	body       string
	secureAuth bool
	err        error
}

func smtpFixture(t *testing.T, mode string, supportTLS bool) (string, *x509.CertPool, <-chan smtpResult) {
	t.Helper()
	certificate, roots := testCertificate(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan smtpResult, 1)
	finished := make(chan struct{})
	t.Cleanup(func() { _ = listener.Close(); <-finished })
	go func() {
		defer close(finished)
		result := smtpResult{}
		defer func() { done <- result }()
		connection, err := listener.Accept()
		if err != nil {
			result.err = err
			return
		}
		defer connection.Close()
		if err := connection.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
			result.err = err
			return
		}
		secure := mode == "tls"
		if secure {
			connection = tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
		}
		write := func(value string) bool {
			_, err := io.WriteString(connection, value)
			if err != nil {
				result.err = err
				return false
			}
			return true
		}
		if !write("220 localhost ESMTP\r\n") {
			return
		}
		reader := textproto.NewReader(bufio.NewReader(connection))
		for {
			line, err := reader.ReadLine()
			if err != nil {
				if !errors.Is(err, io.EOF) {
					result.err = err
				}
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO"):
				response := "250-localhost\r\n"
				if !secure && supportTLS {
					response += "250-STARTTLS\r\n"
				}
				response += "250 AUTH PLAIN\r\n"
				if !write(response) {
					return
				}
			case line == "STARTTLS":
				if !supportTLS {
					if !write("502 sensitive-server-detail\r\n") {
						return
					}
					continue
				}
				if !write("220 ready for TLS\r\n") {
					return
				}
				connection = tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
				reader = textproto.NewReader(bufio.NewReader(connection))
				secure = true
			case strings.HasPrefix(line, "AUTH"):
				result.secureAuth = secure
				if !secure {
					result.err = errors.New("credentials sent before TLS")
					return
				}
				if !write("235 authenticated\r\n") {
					return
				}
			case strings.HasPrefix(line, "MAIL FROM:"), strings.HasPrefix(line, "RCPT TO:"):
				if !write("250 ok\r\n") {
					return
				}
			case line == "DATA":
				if !write("354 continue\r\n") {
					return
				}
				body, err := reader.ReadDotBytes()
				if err != nil {
					result.err = err
					return
				}
				result.body = string(body)
				if !write("250 queued\r\n") {
					return
				}
			case line == "QUIT":
				write("221 goodbye\r\n")
				return
			default:
				result.err = fmt.Errorf("unexpected SMTP command")
				return
			}
		}
	}()
	return listener.Addr().String(), roots, done
}

func TestSMTPRequiresTLSBeforeCredentials(t *testing.T) {
	for _, mode := range []string{"tls", "starttls"} {
		t.Run(mode, func(t *testing.T) {
			address, roots, done := smtpFixture(t, mode, true)
			sender := smtpSender{config: config.Mail{From: "sender@example.test", SMTPAddress: address, SMTPSecurity: mode,
				SMTPUsername: "synthetic-user", SMTPPassword: "synthetic-password", Timeout: 3 * time.Second}, rootCAs: roots}
			message := workspace.ActionMail{Kind: workspace.InvitationMail, Recipient: "recipient@example.test", WorkspaceName: "测试空间",
				Role: "viewer", URL: "https://example.test/invitations/accept#token=synthetic", ExpiresAtMS: time.Now().Add(time.Hour).UnixMilli()}
			if err := sender.Send(t.Context(), message); err != nil {
				t.Fatal(err)
			}
			result := <-done
			if result.err != nil {
				t.Fatal(result.err)
			}
			if !result.secureAuth {
				t.Fatal("SMTP authentication was not protected by TLS")
			}
			parsed, err := stdmail.ReadMessage(strings.NewReader(result.body))
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := io.ReadAll(parsed.Body)
			if err != nil {
				t.Fatal(err)
			}
			body, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), message.URL) || parsed.Header.Get("To") != message.Recipient {
				t.Fatal("SMTP message did not retain the confirmation link and recipient")
			}
		})
	}
	t.Run("refuse plaintext", func(t *testing.T) {
		address, roots, done := smtpFixture(t, "starttls", false)
		sender := smtpSender{config: config.Mail{From: "sender@example.test", SMTPAddress: address, SMTPSecurity: "starttls",
			SMTPUsername: "synthetic-user", SMTPPassword: "synthetic-password", Timeout: 3 * time.Second}, rootCAs: roots}
		err := sender.Send(t.Context(), workspace.ActionMail{Kind: workspace.InvitationMail, Recipient: "recipient@example.test"})
		if !errors.Is(err, ErrDelivery) || strings.Contains(err.Error(), "sensitive-server-detail") {
			t.Fatal("SMTP failure was not safely normalized")
		}
		result := <-done
		if result.secureAuth || result.body != "" {
			t.Fatal("SMTP sent credentials or mail without TLS")
		}
	})
}

func TestSMTPCancellationInterruptsGreeting(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	accepted := make(chan struct{})
	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		close(accepted)
		var value [1]byte
		_, _ = connection.Read(value[:])
	}()
	t.Cleanup(func() { _ = listener.Close(); <-serverDone })
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	sender := smtpSender{config: config.Mail{From: "sender@example.test", SMTPAddress: listener.Addr().String(), SMTPSecurity: "starttls", Timeout: 5 * time.Second}}
	finished := make(chan error, 1)
	go func() {
		finished <- sender.Send(ctx, workspace.ActionMail{Kind: workspace.InvitationMail, Recipient: "recipient@example.test"})
	}()
	<-accepted
	cancel()
	if err := <-finished; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation was not preserved: %v", err)
	}
	<-serverDone
}
