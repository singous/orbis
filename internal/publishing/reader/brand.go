package reader

import _ "embed"

//go:embed brand.svg
var brandMark string

// Static assets are delivered by the frontend on the same public origin.
const brandIcons = `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`

func brandAttribution() string {
	return `<span class="orbis-attribution">由 ` + brandMark + ` <strong>Orbis</strong> 提供支持</span>`
}
