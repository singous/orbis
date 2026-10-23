//go:build integration

package testenv

import (
	"errors"
	"github.com/getkin/kin-openapi/openapi3filter"
	"net/http"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
	"github.com/getkin/kin-openapi/routers/legacy/pathpattern"
)

// Contract catch-all parameters remain ordinary OpenAPI parameters; the extension records Gin's slash matching.
type contractRouter struct {
	ordinary routers.Router
	catchAll pathpattern.Node
}

var readerDecoders sync.Once

func newContractRouter(spec *openapi3.T) (routers.Router, error) {
	readerDecoders.Do(func() {
		for _, kind := range []string{"text/html", "text/css", "application/javascript", "application/xml", "image/svg+xml", "text/markdown"} {
			openapi3filter.RegisterBodyDecoder(kind, openapi3filter.PlainBodyDecoder)
		}
	})
	ordinary, err := legacy.NewRouter(spec)
	if err != nil {
		return nil, err
	}
	result := &contractRouter{ordinary: ordinary}
	for path, item := range spec.Paths.Map() {
		for method, operation := range item.Operations() {
			pattern := path
			for _, parameter := range operation.Parameters {
				p := parameter.Value
				if p != nil && p.In == "path" && p.Extensions["x-catch-all"] == true {
					pattern = strings.ReplaceAll(pattern, "{"+p.Name+"}", "{"+p.Name+"*}")
				}
			}
			if pattern != path {
				if err := result.catchAll.Add(method+" "+pattern, &routers.Route{Spec: spec, Path: path, PathItem: item, Method: method, Operation: operation}, nil); err != nil {
					return nil, err
				}
			}
		}
	}
	return result, nil
}
func (r *contractRouter) FindRoute(request *http.Request) (*routers.Route, map[string]string, error) {
	route, params, err := r.ordinary.FindRoute(request)
	var routeError *routers.RouteError
	missing := errors.Is(err, routers.ErrPathNotFound) || (errors.As(err, &routeError) && routeError.Reason == routers.ErrPathNotFound.Error())
	if err == nil || !missing {
		return route, params, err
	}
	node, values := r.catchAll.Match(request.Method + " " + request.URL.Path)
	if node == nil {
		return nil, nil, err
	}
	route, ok := node.Value.(*routers.Route)
	if !ok {
		return nil, nil, err
	}
	params = map[string]string{}
	for i, name := range node.VariableNames {
		params[strings.TrimSuffix(name, "*")] = values[i]
	}
	return route, params, nil
}
