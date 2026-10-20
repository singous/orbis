//go:build integration

package publishing_test

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/crdtengine"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/tests/testenv"
)

func TestCollaborationPublishesDurableProjectionAndKeepsReleaseImmutable(t *testing.T) {
	f := newSiteWithEnvironment(t, testenv.NewWithCollaboration(t))
	blocks := []document.Block{paragraph("Before collaboration")}
	f.write(t, "Collaborative source", blocks)
	state := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "POST", f.docPath+"/collaboration", f.session.AccessToken, nil, 200))
	engine, err := crdtengine.New(os.Getenv("ORBIS_TEST_COLLABORATION_URL"), os.Getenv("ORBIS_TEST_COLLABORATION_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(engine.Close)
	apply := func(text string) document.CollaborationUpdate {
		t.Helper()
		blocks[0].Content[0].Text = text
		canonical, err := document.Normalize(blocks)
		if err != nil {
			t.Fatal(err)
		}
		transformed, err := engine.Transform(t.Context(), document.CollaborationTransform{State: state.State, Blocks: &canonical})
		if err != nil {
			t.Fatal(err)
		}
		input := document.CollaborationUpdate{OperationID: uuid.NewString(), Epoch: state.Epoch, Update: transformed.Update}
		result := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.docPath+"/collaboration/updates", f.session.AccessToken, input, 200))
		state = testenv.Decode[document.CollaborationState](t, f.env.Call(t, "GET", f.docPath+"/collaboration", f.session.AccessToken, nil, 200))
		if state.ContentVersion != result.ContentVersion {
			t.Fatal("acknowledgment did not identify the durable snapshot")
		}
		f.contentVersion = result.ContentVersion
		return input
	}
	apply("Published collaborative body")
	f.publish(t)
	public := "/api/v1/public/sites/public-site/pages/guide/start"
	page := testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public, "", nil, 200))
	if !strings.Contains(page.PlainText, "Published collaborative body") {
		t.Fatal("publication did not read the committed CRDT projection")
	}
	last := apply("Unpublished durable draft")
	page = testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public, "", nil, 200))
	if strings.Contains(page.PlainText, "Unpublished") {
		t.Fatal("a collaborative draft mutated an immutable publication")
	}
	search := testenv.Decode[struct{ Items []struct{ ID string } }](t, f.env.Call(t, "GET", f.base+"/search?q=Unpublished", f.session.AccessToken, nil, 200))
	if len(search.Items) != 1 || search.Items[0].ID != f.did {
		t.Fatal("search did not read the current committed CRDT projection")
	}
	f.env.RestartApplication(t)
	restarted := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "GET", f.docPath+"/collaboration", f.session.AccessToken, nil, 200))
	if restarted.Epoch != state.Epoch || !bytes.Equal(restarted.State, state.State) {
		t.Fatal("application restart changed persistent CRDT identity")
	}
	replayed := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.docPath+"/collaboration/updates", f.session.AccessToken, last, 200))
	if replayed.ContentVersion != state.ContentVersion {
		t.Fatal("retry after restart created another content version")
	}
	f.publish(t)
	page = testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public, "", nil, 200))
	if !strings.Contains(page.PlainText, "Unpublished durable draft") {
		t.Fatal("republish did not select the latest durable collaborative source")
	}
}
