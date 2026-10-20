package markdown

import (
	"bytes"
	"context"
	"strings"

	"github.com/yuin/goldmark/v2/ast"
	"github.com/yuin/goldmark/v2/extension"
	"github.com/yuin/goldmark/v2/parser"
	"github.com/yuin/goldmark/v2/text"
	"github.com/yuin/goldmark/v2/util"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const MaxParseWork = 4 * MaxASTNodes
const budgetParserPriority = 0

type parseAbort struct{ err error }
type parseBudget struct {
	ctx  context.Context
	work int
}

func (b *parseBudget) step() {
	if err := b.ctx.Err(); err != nil {
		panic(parseAbort{err})
	}
	b.work++
	if b.work > MaxParseWork {
		b.reject()
	}
}
func (b *parseBudget) reject() {
	panic(parseAbort{fault.Field("body.markdown", "Markdown 解析复杂度超出限制")})
}

type blockBudget struct{ budget *parseBudget }

func (blockBudget) Trigger() []byte { return nil }
func (p blockBudget) Open(_ ast.Node, _ text.Reader, ctx parser.Context) (ast.Node, parser.State) {
	p.budget.step()
	if len(ctx.OpenedBlocks()) > MaxASTDepth {
		p.budget.reject()
	}
	return nil, parser.NoChildren
}
func (blockBudget) Continue(ast.Node, text.Reader, parser.Context) parser.State { return parser.Close }
func (blockBudget) Close(ast.Node, text.Reader, parser.Context)                 {}
func (blockBudget) CanInterruptParagraph() bool                                 { return true }
func (blockBudget) CanAcceptIndentedLine() bool                                 { return true }

type inlineBudget struct{ budget *parseBudget }

func (inlineBudget) Trigger() []byte { return []byte("!&*<>[]_`~\\") }
func (p inlineBudget) Parse(ast.Node, text.Reader, parser.Context) ast.Node {
	p.budget.step()
	return nil
}

type tableBudget struct{ budget *parseBudget }

func (p tableBudget) Transform(node *ast.Paragraph, reader text.Reader, _ parser.Context) {
	lines := node.Source()
	for i := 1; i < len(lines); i++ {
		p.budget.step()
		delimiter := strings.TrimSpace(string(lines[i].Bytes(reader.Source())))
		if !strings.Contains(delimiter, "-") {
			continue
		}
		delimiter = strings.TrimPrefix(delimiter, "|")
		delimiter = strings.TrimSuffix(delimiter, "|")
		parts := strings.Split(delimiter, "|")
		valid := len(parts) > 0
		for _, part := range parts {
			part = strings.TrimSpace(part)
			part = strings.TrimPrefix(part, ":")
			part = strings.TrimSuffix(part, ":")
			if part == "" || strings.Trim(part, "-") != "" {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		// A GFM table is expanded before inline parsing. Bound its potential cells before that allocation occurs.
		header := bytes.TrimSpace(lines[i-1].Bytes(reader.Source()))
		header = bytes.TrimPrefix(header, []byte{'|'})
		header = bytes.TrimSuffix(header, []byte{'|'})
		columns := 1
		escaped := false
		for _, value := range header {
			if escaped {
				escaped = false
				continue
			}
			if value == '\\' {
				escaped = true
				continue
			}
			if value == '|' {
				columns++
			}
		}
		if columns != len(parts) {
			continue
		}
		rows := len(lines) - i
		if columns > document.MaxGridColumns || rows > document.MaxGridRows || columns*rows > document.MaxGridCells {
			p.budget.reject()
		}
	}
}

// parseAST uses controlled aborts because the parser callback interfaces cannot return an error.
// Only our private sentinel is recovered; programming panics still propagate to the owning request/task boundary.
func parseAST(ctx context.Context, source []byte) (root ast.Node, result error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			if stopped, ok := recovered.(parseAbort); ok {
				root = nil
				result = stopped.err
			} else {
				panic(recovered)
			}
		}
	}()
	budget := &parseBudget{ctx: ctx}
	processor := parser.New(
		parser.WithExtensions(extension.TableParser, extension.TaskListItemParser, extension.StrikethroughParser),
		parser.WithBlockParsers(util.Prioritized[parser.BlockParser](blockBudget{budget}, budgetParserPriority)),
		parser.WithInlineParsers(util.Prioritized[parser.InlineParser](inlineBudget{budget}, budgetParserPriority)),
		parser.WithParagraphTransformers(util.Prioritized[parser.ParagraphTransformer](tableBudget{budget}, budgetParserPriority)),
	)
	return processor.Parse(source), nil
}
