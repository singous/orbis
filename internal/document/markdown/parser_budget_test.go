package markdown

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestParserRejectsDenseBlocksAndInlineWorkBeforeBuildingUnboundedAST(t *testing.T) {
	for name, source := range map[string]string{"paragraphs": strings.Repeat("x\n\n", MaxParseWork+1), "inline": strings.Repeat("*x* ", MaxParseWork+1)} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseWithLimit(t.Context(), source, "00000000-0000-4000-8000-000000000001", 32<<20); err == nil {
				t.Fatal("dense input escaped the parser work budget")
			}
		})
	}
}
func TestParserBoundsTableExpansionAndKeepsLiteralCode(t *testing.T) {
	header := strings.Repeat("value|", 64) + "\n"
	separator := strings.Repeat("---|", 64) + "\n"
	rows := strings.Repeat(strings.Repeat("x|", 64)+"\n", 2000)
	if _, err := Parse(t.Context(), header+separator+rows, "00000000-0000-4000-8000-000000000001"); err == nil {
		t.Fatal("oversized GFM table was expanded")
	}
	literal := strings.Repeat("*not parsed* [literal] | ", 20000)
	result, err := Parse(t.Context(), "```text\n"+literal+"\n```", "00000000-0000-4000-8000-000000000001")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Blocks) != 1 || result.Blocks[0].Content[0].Text != literal {
		t.Fatal("parser probes changed literal fenced code")
	}
}

type checkedContext struct {
	context.Context
	remaining int
}

func (c *checkedContext) Err() error {
	c.remaining--
	if c.remaining < 0 {
		return context.Canceled
	}
	return nil
}
func TestParserObservesCancellationDuringParse(t *testing.T) {
	ctx := &checkedContext{Context: t.Context(), remaining: 100}
	_, err := Parse(ctx, strings.Repeat("paragraph\n\n", 1000), "00000000-0000-4000-8000-000000000001")
	if !errors.Is(err, context.Canceled) {
		t.Fatal("parser deferred cancellation until after full AST creation")
	}
}
