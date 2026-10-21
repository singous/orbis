package config

import (
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const DefaultMailTimeout = 10 * time.Second

type Mail struct {
	Transport     string
	OutboxDir     string
	PublicBaseURL string
	From          string
	SMTPAddress   string
	SMTPUsername  string
	SMTPPassword  string
	SMTPSecurity  string
	Timeout       time.Duration
}

func loadMail() Mail {
	mode := os.Getenv("ORBIS_MAIL_TRANSPORT")
	if mode == "" {
		mode = "disabled"
	}
	security := os.Getenv("ORBIS_SMTP_SECURITY")
	if security == "" {
		security = "starttls"
	}
	return Mail{
		Transport: mode, OutboxDir: os.Getenv("ORBIS_MAIL_OUTBOX_DIR"), PublicBaseURL: os.Getenv("ORBIS_PUBLIC_BASE_URL"),
		From: os.Getenv("ORBIS_MAIL_FROM"), SMTPAddress: os.Getenv("ORBIS_SMTP_ADDRESS"),
		SMTPUsername: os.Getenv("ORBIS_SMTP_USERNAME"), SMTPPassword: os.Getenv("ORBIS_SMTP_PASSWORD"),
		SMTPSecurity: security, Timeout: DefaultMailTimeout,
	}
}

// Validate rejects ambiguous link bases and plaintext SMTP credential transport.
func (m Mail) Validate() error {
	if m.Transport == "" || m.Transport == "disabled" {
		return nil
	}
	if m.Transport != "outbox" && m.Transport != "smtp" {
		return fmt.Errorf("mail transport must be disabled, outbox or smtp")
	}
	base, err := url.Parse(m.PublicBaseURL)
	if err != nil || base == nil {
		return fmt.Errorf("mail requires a valid public base URL")
	}
	validScheme := base.Scheme == "https" || base.Scheme == "http"
	if !validScheme || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return fmt.Errorf("public base URL must be HTTP(S) without credentials, query or fragment")
	}
	if m.Transport == "outbox" {
		if strings.TrimSpace(m.OutboxDir) == "" {
			return fmt.Errorf("outbox mail requires an explicit directory")
		}
		return nil
	}
	host, port, err := net.SplitHostPort(m.SMTPAddress)
	if err != nil || host == "" {
		return fmt.Errorf("SMTP address must contain a host and port")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("invalid SMTP port")
	}
	from, err := mail.ParseAddress(m.From)
	if err != nil || from.Address != m.From {
		return fmt.Errorf("SMTP requires a valid sender email")
	}
	if m.SMTPSecurity != "tls" && m.SMTPSecurity != "starttls" {
		return fmt.Errorf("SMTP security must be tls or starttls")
	}
	if (m.SMTPUsername == "") != (m.SMTPPassword == "") {
		return fmt.Errorf("SMTP authentication requires both username and password")
	}
	if m.Timeout <= 0 {
		return fmt.Errorf("SMTP timeout must be positive")
	}
	return nil
}
