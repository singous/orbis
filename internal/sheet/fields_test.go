package sheet

import (
	"math"
	"testing"

	"github.com/google/uuid"
)

func TestTypedValuesRejectInvalidInput(t *testing.T) {
	for _, test := range []struct {
		kind  string
		value any
	}{{"number", math.Inf(1)}, {"number", "123"}, {"rating", 6.0}, {"rating", 1.5}, {"progress", 101.0}, {"datetime", 1.5}, {"url", "javascript:alert(1)"}, {"email", "invalid"}, {"multi_select", []any{"unknown"}}, {"person", []any{false}}} {
		t.Run(test.kind, func(t *testing.T) {
			if _, err := NormalizeValue(Field{Name: "Value", Kind: test.kind}, test.value); err == nil {
				t.Fatalf("accepted invalid %s value", test.kind)
			}
		})
	}
}
func TestDefaultsAndSystemOwnership(t *testing.T) {
	id := uuid.NewString()
	system := uuid.NewString()
	d := Definition{Fields: []Field{{ID: id, Name: "Progress", Kind: "progress", Default: 20}, {ID: system, Name: "Creator", Kind: "created_by"}}}
	values, err := NormalizeValues(d, map[string]any{}, true)
	if err != nil || values[id] != float64(20) {
		t.Fatalf("default not normalized: %v %v", values, err)
	}
	if _, err := NormalizeValues(d, map[string]any{system: uuid.NewString()}, false); err == nil {
		t.Fatal("client wrote system field")
	}
	values, err = NormalizeValues(d, map[string]any{id: nil}, true)
	if err != nil || values[id] != nil {
		t.Fatal("explicit clearing was replaced by default")
	}
}
