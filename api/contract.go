// Package api contains the versioned HTTP and content contracts.
package api

import _ "embed"

//go:embed openapi.json
var Contract []byte

//go:embed board-catalog.json
var BoardCatalog []byte

//go:embed board-icons.json
var BoardIcons []byte

//go:embed board-templates.json
var BoardTemplates []byte
