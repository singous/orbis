// Package publicview builds an explicit reader projection of document content.
package publicview

import (
	"net/netip"
	"net/url"
	"path"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/idna"
	"orbis.local/orbis/internal/platform/fault"
)

func Unsafe() error {
	return fault.New(fault.Validation, "PUBLIC_CONTENT_UNSAFE", "正文含有未公开的资源、私有地址或敏感链接，请检查后重试")
}

// URLPolicy is constructed at the use-case boundary; it never trusts request Host or forwarded headers.
type URLPolicy struct {
	InternalHosts  []string
	DocumentLinks  map[string]string
	PublicPrefixes []string
}

func credentialKey(value string) bool {
	for range 3 {
		decoded, err := url.QueryUnescape(value)
		if err != nil || decoded == value {
			break
		}
		value = decoded
	}
	value = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, value)
	switch value {
	case "token", "accesstoken", "refreshtoken", "idtoken", "authtoken", "downloadtoken", "securitytoken", "apikey", "accesskey", "secret", "clientsecret", "clientassertion", "password", "passwd", "authorization", "auth", "authkey", "session", "sessionid", "credential", "credentials", "signature", "sig", "keypairid", "policy", "xamzcredential", "xamzsignature", "xamzsecuritytoken", "xamzalgorithm", "xgoogcredential", "xgoogsignature", "xgoogalgorithm", "googleaccessid", "awsaccesskeyid", "ossaccesskeyid", "ossaccesskeysecret", "qsignature", "qsignalgorithm":
		return true
	}
	return false
}
func hostIdentity(value string) string {
	if ip, err := netip.ParseAddr(value); err == nil {
		return ip.Unmap().String()
	}
	value, err := idna.Lookup.ToASCII(strings.ToLower(value))
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(value, ".")
}
func canonicalHost(host string) (string, error) {
	if strings.Contains(host, "%") {
		return "", Unsafe()
	}
	var err error
	if !strings.Contains(host, ":") {
		host, err = idna.Lookup.ToASCII(strings.ToLower(host))
		if err != nil {
			return "", Unsafe()
		}
	}
	host = strings.TrimSuffix(host, ".")
	if ip, err := netip.ParseAddr(host); err == nil {
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
			return "", Unsafe()
		}
		for _, raw := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/32", "2002::/16"} {
			prefix, err := netip.ParsePrefix(raw)
			if err == nil && prefix.Contains(ip) {
				return "", Unsafe()
			}
		}
		return ip.String(), nil
	}
	for _, suffix := range []string{".localhost", ".local", ".internal", ".lan", ".home.arpa"} {
		if strings.HasSuffix(host, suffix) {
			return "", Unsafe()
		}
	}
	parts := strings.Split(host, ".")
	if len(parts) < 2 {
		return "", Unsafe()
	}
	last := parts[len(parts)-1]
	if _, err := strconv.ParseUint(last, 10, 64); err == nil || strings.HasPrefix(last, "0x") {
		return "", Unsafe()
	}
	return host, nil
}
func normalizedPath(value string) (string, error) {
	for range 3 {
		decoded, err := url.PathUnescape(value)
		if err != nil {
			return "", Unsafe()
		}
		if decoded == value {
			break
		}
		value = decoded
	}
	if strings.ContainsAny(value, "%\\\x00\r\n") {
		return "", Unsafe()
	}
	return path.Clean("/" + strings.TrimPrefix(value, "/")), nil
}
func (p URLPolicy) Link(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if strings.TrimSpace(value) != value || strings.ContainsAny(value, "\\\x00\r\n\t") {
		return "", Unsafe()
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.User != nil {
		return "", Unsafe()
	}
	for _, raw := range []string{parsed.RawQuery, parsed.Fragment} {
		_, tail, hasQuestion := strings.Cut(raw, "?")
		if hasQuestion {
			raw = tail
		}
		values, err := url.ParseQuery(raw)
		if err != nil {
			return "", Unsafe()
		}
		for key := range values {
			if credentialKey(key) {
				return "", Unsafe()
			}
		}
	}
	if parsed.Scheme == "" && parsed.Host == "" && parsed.Path == "" && parsed.Fragment != "" {
		return value, nil
	}
	normalized, err := normalizedPath(parsed.EscapedPath())
	if err != nil {
		return "", err
	}
	internal := parsed.Scheme == "" && parsed.Host == ""
	if parsed.Host != "" {
		for _, host := range p.InternalHosts {
			if hostIdentity(parsed.Hostname()) == hostIdentity(host) {
				internal = true
			}
		}
	}
	if internal {
		for id, target := range p.DocumentLinks {
			if normalized == "/documents/"+id || strings.HasSuffix(normalized, "/documents/"+id) || normalized == "/notes/"+id {
				if parsed.RawQuery != "" {
					return "", Unsafe()
				}
				if parsed.Fragment != "" {
					target += "#" + url.PathEscape(parsed.Fragment)
				}
				return target, nil
			}
		}
		for _, prefix := range p.PublicPrefixes {
			if normalized == strings.TrimSuffix(prefix, "/") || strings.HasPrefix(normalized, prefix) {
				return (&url.URL{Path: normalized, RawQuery: parsed.RawQuery, Fragment: parsed.Fragment}).String(), nil
			}
		}
		return "", Unsafe()
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", Unsafe()
	}
	if parsed.Hostname() == "" {
		return "", Unsafe()
	}
	if parsed.Port() != "" {
		port, err := strconv.Atoi(parsed.Port())
		if err != nil || port < 1 || port > 65535 {
			return "", Unsafe()
		}
	}
	if _, err := canonicalHost(parsed.Hostname()); err != nil {
		return "", err
	}
	return value, nil
}
