package pagination

import (
	"math"

	"orbis.local/orbis/internal/platform/fault"
)

const DefaultSize = 20
const MaxSize = 100

type Page struct{ Number, Size int }

// New rejects invalid sizes and offsets that cannot fit the platform integer.
func New(number, size int) (Page, error) {
	if number < 1 {
		return Page{}, fault.Field("query.page", "页码必须大于等于 1")
	}
	if size < 1 || size > MaxSize {
		return Page{}, fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	if number-1 > math.MaxInt/size {
		return Page{}, fault.Field("query.page", "页码超出范围")
	}
	return Page{Number: number, Size: size}, nil
}

// Offset is safe only for pages constructed through New.
func (p Page) Offset() int { return (p.Number - 1) * p.Size }
