package document_test

import (
	"fmt"
	"strings"
	"testing"

	"orbis.local/orbis/internal/document"
)

func BenchmarkVersionContentHash(b *testing.B) {
	for _, count := range []int{1000, 10000} {
		b.Run(fmt.Sprintf("blocks_%d", count), func(b *testing.B) {
			blocks := make([]document.Block, count)
			for i := range blocks {
				blocks[i] = document.Block{ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", i), Type: "paragraph", Props: map[string]any{}, Content: []document.TextRun{{Text: strings.Repeat("x", 400), Marks: []string{}}}, Children: []document.Block{}}
			}
			content := document.Content{Revision: document.Revision{Title: "Snapshot benchmark", TitleRecorded: true}, Blocks: blocks}
			b.ReportAllocs()
			b.SetBytes(int64(count * 400))
			for b.Loop() {
				if _, err := document.VersionContentHash(content); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
