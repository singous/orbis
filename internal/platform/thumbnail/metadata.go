package thumbnail

import (
	"bytes"
	"encoding/binary"

	"orbis.local/orbis/internal/asset"
)

const orientationTag = 0x0112

// exifOrientation reads only the bounded first TIFF directory, never offsets into pixel data.
func exifOrientation(data []byte) int {
	data = bytes.TrimPrefix(data, []byte("Exif\x00\x00"))
	if len(data) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(data[2:4]) != 42 {
		return 1
	}
	offset := uint64(order.Uint32(data[4:8]))
	if offset+2 > uint64(len(data)) {
		return 1
	}
	count := uint64(order.Uint16(data[offset : offset+2]))
	if offset+2+count*12 > uint64(len(data)) {
		return 1
	}
	for index := uint64(0); index < count; index++ {
		entry := data[offset+2+index*12 : offset+2+(index+1)*12]
		if order.Uint16(entry[:2]) == orientationTag && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
			value := int(order.Uint16(entry[8:10]))
			if value >= 1 && value <= 8 {
				return value
			}
			return 1
		}
	}
	return 1
}
func metadata(data []byte, format string) (int, error) {
	orientation := 1
	switch format {
	case "jpeg":
		for pos := 2; pos < len(data); {
			if data[pos] != 0xff {
				return 0, asset.ErrInvalidImage
			}
			for pos < len(data) && data[pos] == 0xff {
				pos++
			}
			if pos >= len(data) {
				return 0, asset.ErrInvalidImage
			}
			marker := data[pos]
			pos++
			if marker == 0xda || marker == 0xd9 {
				break
			}
			if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
				continue
			}
			if pos+2 > len(data) {
				return 0, asset.ErrInvalidImage
			}
			size := int(binary.BigEndian.Uint16(data[pos : pos+2]))
			if size < 2 || size > len(data)-pos {
				return 0, asset.ErrInvalidImage
			}
			if marker == 0xe1 && bytes.HasPrefix(data[pos+2:pos+size], []byte("Exif\x00\x00")) {
				orientation = exifOrientation(data[pos+2 : pos+size])
			}
			pos += size
		}
	case "png":
		for pos := 8; pos < len(data); {
			if pos+12 > len(data) {
				return 0, asset.ErrInvalidImage
			}
			size := uint64(binary.BigEndian.Uint32(data[pos : pos+4]))
			if size+12 > uint64(len(data)-pos) {
				return 0, asset.ErrInvalidImage
			}
			kind := string(data[pos+4 : pos+8])
			chunk := data[pos+8 : pos+8+int(size)]
			if kind == "acTL" {
				return 0, asset.ErrInvalidImage
			}
			if kind == "eXIf" {
				orientation = exifOrientation(chunk)
			}
			pos += int(size) + 12
		}
	case "webp":
		if len(data) < 12 || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
			return 0, asset.ErrInvalidImage
		}
		for pos := 12; pos < len(data); {
			if pos+8 > len(data) {
				return 0, asset.ErrInvalidImage
			}
			size := uint64(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
			padded := size + (size & 1)
			if padded+8 > uint64(len(data)-pos) {
				return 0, asset.ErrInvalidImage
			}
			kind := string(data[pos : pos+4])
			chunk := data[pos+8 : pos+8+int(size)]
			if kind == "ANIM" || kind == "ANMF" || (kind == "VP8X" && len(chunk) > 0 && chunk[0]&2 != 0) {
				return 0, asset.ErrInvalidImage
			}
			if kind == "EXIF" {
				orientation = exifOrientation(chunk)
			}
			pos += int(padded) + 8
		}
	}
	return orientation, nil
}
