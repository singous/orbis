//go:build integration

package client_test

import (
	"fmt"
	"github.com/google/uuid"
	"testing"
)

func TestCLIVersionManagementJourney(t *testing.T) {
	c, _, _, cid := cliFixture(t, false)
	created := c.run(0, "documents", "create", "--collection", cid, "--title", "CLI version document", "--operation-id", uuid.NewString())
	did := created["document_id"].(string)
	metadata := c.run(0, "documents", "get", did)
	source := fmt.Sprintf("%.0f", metadata["content_version"])
	operation := uuid.NewString()
	args := []string{"versions", "save", "--document", did, "--source-revision", source, "--name", "CLI review", "--operation-id", operation}
	version := c.run(0, args...)
	id := version["id"].(string)
	if c.run(0, args...)["id"] != id {
		t.Fatal("CLI retry created another named version")
	}
	listed := c.run(0, "versions", "list", "--document", did, "--page-size", "1")
	if len(listed["items"].([]any)) != 1 {
		t.Fatal("CLI could not list the saved version")
	}
	read := c.run(0, "versions", "get", id, "--document", did)
	if read["version"].(map[string]any)["name"] != "CLI review" {
		t.Fatal("CLI did not read the fixed version")
	}
	c.run(0, "versions", "rename", id, "--document", did, "--expected-metadata-version", "1", "--name", "Reviewed", "--operation-id", uuid.NewString())
	comparison := c.run(0, "versions", "compare", id, "--document", did, "--from", id)
	if len(comparison["items"].([]any)) != 0 {
		t.Fatal("comparing the same version produced changes")
	}
	restoreOperation := uuid.NewString()
	restore := []string{"versions", "restore", id, "--document", did, "--expected-revision", source, "--operation-id", restoreOperation}
	first := c.run(0, restore...)
	second := c.run(0, restore...)
	if first["revision"].(map[string]any)["version"] != second["revision"].(map[string]any)["version"] {
		t.Fatal("CLI restore retry created another revision")
	}
	if c.run(0, "operations", "get", restoreOperation)["kind"] != "version-restore" {
		t.Fatal("CLI version operation receipt was not discoverable")
	}
	c.run(2, "versions", "restore", id, "--document", did, "--expected-revision", "0", "--operation-id", uuid.NewString())
}
