package command

import (
	"strconv"
	"strings"

	"orbis.local/orbis/cli/internal/client"
)

type arguments struct {
	family, command string
	flags           map[string]string
	positionals     []string
	help, version   bool
}
type spec struct {
	values, bools, required string
	positionals             int
}

var specs = map[string]spec{
	"boards templates":   {},
	"boards template":    {values: "template board-page operation-id", required: "template board-page operation-id", positionals: 1},
	"boards list":        {values: "page page-size collection"},
	"boards catalog":     {},
	"boards get":         {values: "revision", positionals: 1},
	"boards elements":    {values: "board-page revision cursor", required: "board-page revision", positionals: 1},
	"boards changes":     {values: "after", required: "after", positionals: 1},
	"boards history":     {values: "before", positionals: 1},
	"boards create":      {values: "file", required: "file"},
	"boards apply":       {values: "file", required: "file", positionals: 1},
	"boards export":      {values: "revision out", required: "out", positionals: 1},
	"doctor":             {},
	"capabilities":       {},
	"schema":             {},
	"config set":         {},
	"config get":         {},
	"auth login":         {bools: "token-stdin", required: "token-stdin"},
	"auth logout":        {},
	"auth status":        {},
	"api ls":             {},
	"workspaces list":    {values: "page page-size"},
	"collections list":   {values: "page page-size"},
	"documents list":     {values: "page page-size collection"},
	"documents search":   {values: "page page-size", positionals: 1},
	"documents resolve":  {values: "title id url"},
	"documents get":      {positionals: 1},
	"documents outline":  {values: "version page-size cursor", positionals: 1},
	"documents changes":  {values: "since-version version page-size cursor", required: "since-version", positionals: 1},
	"documents export":   {values: "version format out", required: "version out", positionals: 1},
	"documents create":   {values: "collection title parent file operation-id wait-seconds", bools: "dry-run", required: "collection title operation-id"},
	"documents import":   {values: "collection title parent file operation-id wait-seconds", bools: "dry-run", required: "collection title operation-id file"},
	"versions list":      {values: "document page-size cursor", required: "document"},
	"versions get":       {values: "document", required: "document", positionals: 1},
	"versions save":      {values: "document source-revision name description operation-id", required: "document source-revision name operation-id"},
	"versions rename":    {values: "document expected-metadata-version name description operation-id", required: "document expected-metadata-version name operation-id", positionals: 1},
	"versions restore":   {values: "document expected-revision operation-id", required: "document expected-revision operation-id", positionals: 1},
	"versions compare":   {values: "document from page-size cursor", required: "document from", positionals: 1},
	"imports get":        {positionals: 1},
	"imports finalize":   {values: "wait-seconds", positionals: 1},
	"blocks list":        {values: "document parent version page-size cursor", required: "document"},
	"blocks get":         {values: "document version", required: "document", positionals: 1},
	"operations preview": {values: "document file", required: "document file"},
	"operations apply":   {values: "document file", required: "document file"},
	"operations get":     {positionals: 1},
	"files upload":       {values: "document file operation-id", required: "document file operation-id"},
	"files get":          {values: "document", required: "document", positionals: 1},
	"files download":     {values: "document out", required: "document out", positionals: 1},
	"shares list":        {values: "collection page page-size", required: "collection"},
	"shares create":      {values: "collection root-document expires-at-ms", bools: "acknowledge-public-scope", required: "collection acknowledge-public-scope"},
	"shares revoke":      {values: "expected-version", required: "expected-version", positionals: 1},
	"request get":        {positionals: 1},
	"request post":       {values: "file", required: "file", positionals: 1},
}

func parse(argv []string) (arguments, error) {
	a := arguments{flags: map[string]string{}}
	values := map[string]bool{}
	bools := map[string]bool{}
	for _, v := range strings.Fields("base-url workspace profile timeout") {
		values[v] = true
	}
	for _, v := range strings.Fields("json allow-http") {
		bools[v] = true
	}
	aliases := map[string]string{"notebook": "collection", "limit": "page-size", "note": "document", "root-note": "root-document"}
	var words []string
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		if arg == "--help" || arg == "-h" {
			a.help = true
			return a, nil
		}
		if arg == "--version" && len(words) == 0 {
			a.version = true
			return a, nil
		}
		if strings.HasPrefix(arg, "--") {
			key, value, eq := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
			if alias, ok := aliases[key]; ok {
				key = alias
			}
			if bools[key] {
				if !eq {
					value = "true"
				}
				if value != "true" && value != "false" {
					return a, argError()
				}
				a.flags[key] = value
				continue
			}
			if !values[key] {
				return a, argError()
			}
			if !eq {
				i++
				if i >= len(argv) {
					return a, argError()
				}
				value = argv[i]
			}
			a.flags[key] = value
			continue
		}
		if strings.HasPrefix(arg, "-") {
			return a, argError()
		}
		words = append(words, arg)
		if len(words) == 1 {
			switch words[0] {
			case "notes":
				words[0] = "documents"
			case "notebooks":
				words[0] = "collections"
			}
		}
		path := strings.Join(words, " ")
		if s, ok := specs[path]; ok {
			a.family = words[0]
			if len(words) > 1 {
				a.command = words[1]
			}
			for _, v := range strings.Fields(s.values) {
				values[v] = true
			}
			for _, v := range strings.Fields(s.bools) {
				bools[v] = true
			}
		} else if a.family != "" {
			a.positionals = append(a.positionals, arg)
		}
	}
	if a.family == "" {
		return a, argError()
	}
	key := a.family
	if a.command != "" {
		key += " " + a.command
	}
	s := specs[key]
	if len(a.positionals) != s.positionals {
		return a, argError()
	}
	for _, key := range strings.Fields(s.required) {
		if a.flags[key] == "" || a.flags[key] == "false" {
			return a, argError()
		}
	}
	if a.family == "documents" && a.command == "resolve" {
		n := 0
		for _, key := range []string{"title", "id", "url"} {
			if a.flags[key] != "" {
				n++
			}
		}
		if n != 1 {
			return a, argError()
		}
	}
	for _, key := range []string{"page", "page-size", "version", "since-version", "expected-version", "expires-at-ms", "revision", "after", "before", "source-revision", "expected-revision", "expected-metadata-version"} {
		if raw := a.flags[key]; raw != "" {
			v, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || v < 0 || (v == 0 && key != "after" && key != "before") || (key == "page-size" && v > 100) {
				return a, argError()
			}
		}
	}
	if f := a.flags["format"]; f != "" && f != "json" && f != "markdown" {
		return a, argError()
	}
	return a, nil
}
func argError() error {
	return client.Failure("CLI_ARGUMENT_INVALID", "命令参数无效，请使用 --help 查看用法", 2, nil)
}

const help = `Orbis CLI — 通过工作空间 Agent API 管理文档

用法: orbis [全局选项] <命令> [子命令] [选项]

命令:
  doctor | capabilities | schema | api ls
  config set|get
  auth login --token-stdin | auth status | auth logout
  workspaces list | collections list
  documents list|search|resolve|get|outline|changes|export|create|import
  boards list|catalog|templates|template|get|elements|changes|history|create|apply|export
  versions list|get|save|rename|compare|restore
  imports get|finalize
  blocks list|get
  operations preview|apply|get
  files upload|get|download
  shares list|create|revoke
  request get|post

全局选项可放在子命令后:
  --json --base-url URL --workspace UUID --profile NAME --allow-http --timeout SECONDS
分页: --page 1 --page-size 20 (最大100)；块、提纲和变更使用 --cursor。
兼容别名: notes/documents, notebooks/collections, --note/--document, --notebook/--collection, --limit/--page-size。
写入需要 --operation-id UUID；原始 JSON 操作请先执行 orbis schema。
完整示例与退出码见 CLI README。
`
