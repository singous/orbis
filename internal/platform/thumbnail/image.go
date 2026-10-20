// Package thumbnail validates and re-encodes avatars without retaining source metadata.
package thumbnail

import (
	"bytes"
	"context"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"orbis.local/orbis/internal/asset"
)

const MaxPixels = 4096 * 4096
const Size = 256

type Normalizer struct{}

// Normalize decodes only bounded static images and emits a metadata-free square PNG.
func (Normalizer) Normalize(ctx context.Context, data []byte) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, asset.ErrInvalidImage
	}
	orientation, err := metadata(data, format)
	if err != nil {
		return nil, err
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil || source.Bounds().Dx() != cfg.Width || source.Bounds().Dy() != cfg.Height {
		return nil, asset.ErrInvalidImage
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	oriented := orientedImage{Image: source, orientation: orientation}
	bounds := oriented.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	x, y := (bounds.Dx()-side)/2, (bounds.Dy()-side)/2
	target := image.NewNRGBA(image.Rect(0, 0, Size, Size))
	draw.CatmullRom.Scale(
		target,
		target.Bounds(),
		oriented,
		image.Rect(x, y, x+side, y+side),
		draw.Src,
		nil,
	)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	if err := png.Encode(&output, target); err != nil {
		return nil, err
	}
	return output.Bytes(), ctx.Err()
}

type orientedImage struct {
	image.Image
	orientation int
}

func (i orientedImage) Bounds() image.Rectangle {
	b := i.Image.Bounds()
	w, h := b.Dx(), b.Dy()
	if i.orientation >= 5 {
		w, h = h, w
	}
	return image.Rect(0, 0, w, h)
}
func (i orientedImage) At(x, y int) color.Color {
	b := i.Image.Bounds()
	w, h := b.Dx(), b.Dy()
	switch i.orientation {
	case 2:
		x = w - 1 - x
	case 3:
		x, y = w-1-x, h-1-y
	case 4:
		y = h - 1 - y
	case 5:
		x, y = y, x
	case 6:
		x, y = y, h-1-x
	case 7:
		x, y = w-1-y, h-1-x
	case 8:
		x, y = w-1-y, x
	}
	return i.Image.At(x+b.Min.X, y+b.Min.Y)
}
