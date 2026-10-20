// Package api contains the versioned HTTP and content contracts.
package api

import _ "embed"

//go:embed openapi.json
var Contract []byte
