package search

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSnippetUnicodeAndPlainText(t *testing.T) {
	text := strings.Repeat("前", 300) + "关键字 <script> & value " + strings.Repeat("后", 300)
	result := Snippet(text, "关键字")
	if utf8.RuneCountInString(result) > MaxSnippetLength || !strings.Contains(result, "关键字 <script>") || !strings.HasPrefix(result, "…") || !strings.HasSuffix(result, "…") {
		t.Fatalf("incorrect snippet %q", result)
	}
	if got := Snippet(" A\n\tB ", "b"); got != "A B" {
		t.Fatal(got)
	}
}
