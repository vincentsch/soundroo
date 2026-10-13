// Package cloud is the soundroo.com REST client: service origins, requests,
// response shapes and the stable error contract shared by every command.
package cloud

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// DefaultService is the production origin. Test builds may replace it with
// -ldflags "-X github.com/vincentsch/soundroo/cloud-cli/internal/cloud.DefaultService=...".
var DefaultService = "https://soundroo.com"

// ParseOrigin validates a service origin and returns its canonical form:
// lowercase scheme and host, no default port, no path, query, fragment or user
// information. HTTPS is required except for loopback development servers.
func ParseOrigin(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("the Soundroo service URL is empty")
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("%q is not a service URL such as https://soundroo.com", raw)
	}
	scheme := strings.ToLower(u.Scheme)
	if u.User != nil {
		return "", fmt.Errorf("the service URL must not contain a user name or password")
	}
	if u.RawQuery != "" || u.Fragment != "" || u.ForceQuery {
		return "", fmt.Errorf("the service URL must not contain a query or fragment")
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("use the service origin without a path, for example https://soundroo.com")
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if host == "" {
		return "", fmt.Errorf("%q has no host name", raw)
	}
	switch scheme {
	case "https":
		if port == "443" {
			port = ""
		}
	case "http":
		if !IsLoopback(host) {
			return "", fmt.Errorf("plain http is allowed only for a local development server on 127.0.0.1, [::1] or localhost; use https for %s", host)
		}
		if port == "80" {
			port = ""
		}
	default:
		return "", fmt.Errorf("use an https service URL, not %s", scheme)
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		return scheme + "://" + host + ":" + port, nil
	}
	return scheme + "://" + host, nil
}

// IsLoopback reports whether host names this computer.
func IsLoopback(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// SameOrigin reports whether target is an absolute URL on origin.
func SameOrigin(origin, target string) bool {
	u, err := url.Parse(target)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false
	}
	got, err := ParseOrigin(u.Scheme + "://" + u.Host)
	return err == nil && got == origin
}

// ValidateServiceValue is the rungrad service validator for --service and
// SOUNDROO_URL.
func ValidateServiceValue(value string) error {
	_, err := ParseOrigin(value)
	return err
}
