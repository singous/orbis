package thumbnail

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"orbis.local/orbis/internal/asset"
)

func samplePNG(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	source := image.NewNRGBA(image.Rect(0, 0, 320, 160))
	for y := range 160 {
		for x := range 320 {
			source.SetNRGBA(x, y, color.NRGBA{R: byte(x), G: byte(y), A: 255})
		}
	}
	if err := png.Encode(&output, source); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
func pngChunk(kind string, data []byte) []byte {
	result := make([]byte, 12+len(data))
	binary.BigEndian.PutUint32(result[:4], uint32(len(data)))
	copy(result[4:8], kind)
	copy(result[8:], data)
	binary.BigEndian.PutUint32(result[len(result)-4:], crc32.ChecksumIEEE(result[4:len(result)-4]))
	return result
}
func TestNormalizeDimensionsFormatsAndMetadata(t *testing.T) {
	original := samplePNG(t)
	encoded := append([]byte{}, original[:33]...)
	encoded = append(encoded, pngChunk("tEXt", []byte("private\x00remove this metadata"))...)
	encoded = append(encoded, original[33:]...)
	decoded, err := png.Decode(bytes.NewReader(original))
	if err != nil {
		t.Fatal(err)
	}
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, decoded, nil); err != nil {
		t.Fatal(err)
	}
	// A one-pixel static WebP fixture.
	webp, err := base64.StdEncoding.DecodeString("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		data []byte
	}{{"png", encoded}, {"jpeg", jpg.Bytes()}, {"webp", webp}} {
		t.Run(test.name, func(t *testing.T) {
			data, err := (Normalizer{}).Normalize(t.Context(), test.data)
			if err != nil {
				t.Fatal(err)
			}
			cfg, err := png.DecodeConfig(bytes.NewReader(data))
			if err != nil || cfg.Width != Size || cfg.Height != Size {
				t.Fatalf("normalized dimensions: %+v %v", cfg, err)
			}
			if bytes.Contains(data, []byte("remove this metadata")) {
				t.Fatal("source metadata leaked")
			}
		})
	}
}
func TestNormalizeRejectsMalformedAnimatedAndOversizedImages(t *testing.T) {
	original := samplePNG(t)
	broken := append([]byte{}, original...)
	broken[29] ^= 1
	huge := append([]byte{}, original...)
	binary.BigEndian.PutUint32(huge[16:20], MaxPixels+1)
	binary.BigEndian.PutUint32(huge[20:24], 1)
	binary.BigEndian.PutUint32(huge[29:33], crc32.ChecksumIEEE(huge[12:29]))
	animated := append([]byte{}, original[:33]...)
	animated = append(animated, pngChunk("acTL", []byte{0, 0, 0, 2, 0, 0, 0, 0})...)
	animated = append(animated, original[33:]...)
	for _, data := range [][]byte{[]byte("<svg></svg>"), broken, huge, animated, original[:20]} {
		if _, err := (Normalizer{}).Normalize(t.Context(), data); !errors.Is(err, asset.ErrInvalidImage) {
			t.Fatalf("invalid image accepted: %v", err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := (Normalizer{}).Normalize(ctx, original); !errors.Is(err, context.Canceled) {
		t.Fatal("image normalization ignored cancellation")
	}
}
func TestExifOrientationMappings(t *testing.T) {
	source := image.NewGray(image.Rect(0, 0, 3, 2))
	for i := range 6 {
		source.SetGray(i%3, i/3, color.Gray{Y: byte(i + 1)})
	}
	expected := [][]byte{
		{1, 2, 3, 4, 5, 6},
		{3, 2, 1, 6, 5, 4},
		{6, 5, 4, 3, 2, 1},
		{4, 5, 6, 1, 2, 3},
		{1, 4, 2, 5, 3, 6},
		{4, 1, 5, 2, 6, 3},
		{6, 3, 5, 2, 4, 1},
		{3, 6, 2, 5, 1, 4},
	}
	for orientation := 1; orientation <= 8; orientation++ {
		actual := []byte{}
		view := orientedImage{Image: source, orientation: orientation}
		for y := range view.Bounds().Dy() {
			for x := range view.Bounds().Dx() {
				actual = append(actual, color.GrayModel.Convert(view.At(x, y)).(color.Gray).Y)
			}
		}
		if !bytes.Equal(actual, expected[orientation-1]) {
			t.Fatalf("orientation %d: %v", orientation, actual)
		}
		for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
			exif := make([]byte, 26)
			copy(exif, "II")
			if order == binary.BigEndian {
				copy(exif, "MM")
			}
			order.PutUint16(exif[2:4], 42)
			order.PutUint32(exif[4:8], 8)
			order.PutUint16(exif[8:10], 1)
			order.PutUint16(exif[10:12], orientationTag)
			order.PutUint16(exif[12:14], 3)
			order.PutUint32(exif[14:18], 1)
			order.PutUint16(exif[18:20], uint16(orientation))
			if exifOrientation(exif) != orientation {
				t.Fatal("Exif orientation was not decoded")
			}
			pngData := samplePNG(t)
			withExif := append([]byte{}, pngData[:33]...)
			withExif = append(withExif, pngChunk("eXIf", exif)...)
			withExif = append(withExif, pngData[33:]...)
			value, err := metadata(withExif, "png")
			if err != nil || value != orientation {
				t.Fatal("PNG Exif metadata was not found")
			}
		}
	}
}
