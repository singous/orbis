# ELK source availability and build materials

Orbis retains the unmodified `elkjs` 0.12.0 worker and uses its declared EPL-2.0 option. The original `EPL-2.0 OR GPL-3.0-or-later` declaration and license text remain in the inventory. The selection and its engineering assessment are recorded in [`../reviews.json`](../reviews.json).

The three full official source archives in [`packages.tsv`](packages.tsv) are shipped alongside this document. Their immutable revisions and SHA-256 values are verified before packaging:

| Material | Revision | Role |
| --- | --- | --- |
| elkjs release | `ff5771d7165445c42c408bb8a090c8035272218c` | Wrapper, original Gradle wrapper, Java/GWT build and generated reference workers |
| Official ELK 0.12.0 | `323312916048544e4e594eab3303cdb0d01e2929` | Java algorithm and graph sources |
| ELK metadata compiler | `0c51a28df40d0334b41b94c05b9fa9a07f3752ba` | Source for the graph/core.meta `0.12.0-SNAPSHOT` metadata artifacts used by the demonstrated build |

These are editable upstream Java, configuration and generator sources, rather than only the npm-generated JavaScript. The public `/licenses/` page links directly to all three shipped archives. [`elkjs-review.md`](elkjs-review.md) preserves the build inputs, generated artifact hashes and bounded comparison evidence.

## Build path

The demonstrated environment used Maven 3.9.16, Microsoft OpenJDK 17.0.16 and the release's unchanged Gradle 7.2 wrapper. Gradle resolves GWT 2.11.0 and the other dependencies declared by upstream. Network access to those declared repositories is required. The wrapper distribution's SHA-256 is `f581709a9c35e9cb92e16f585d2c4bc99b2b1a5f85d2badbd3dc6bff59e1e6dd`.

The following commands adapt the successful experiment to a new working directory. Start in the directory containing this document and the three archives, with `JAVA_HOME` pointing to an existing JDK 17 installation:

```sh
ORBIS_ELK_ARCHIVE_DIR="$(pwd)"
ORBIS_ELK_BUILD_DIR="$(mktemp -d)"
export ORBIS_ELK_METADATA_REPO="$ORBIS_ELK_BUILD_DIR/m2"

tar -xzf "$ORBIS_ELK_ARCHIVE_DIR/elkjs-ff5771d7165445c42c408bb8a090c8035272218c.tar.gz" -C "$ORBIS_ELK_BUILD_DIR"
tar -xzf "$ORBIS_ELK_ARCHIVE_DIR/elk-323312916048544e4e594eab3303cdb0d01e2929.tar.gz" -C "$ORBIS_ELK_BUILD_DIR"
tar -xzf "$ORBIS_ELK_ARCHIVE_DIR/elk-meta-0c51a28df40d0334b41b94c05b9fa9a07f3752ba.tar.gz" -C "$ORBIS_ELK_BUILD_DIR"

cat > "$ORBIS_ELK_BUILD_DIR/maven-settings.xml" <<'XML'
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"/>
XML

cd "$ORBIS_ELK_BUILD_DIR/elk-0c51a28df40d0334b41b94c05b9fa9a07f3752ba/build"
mvn --batch-mode --no-transfer-progress \
  --settings "$ORBIS_ELK_BUILD_DIR/maven-settings.xml" \
  -P elk-meta -Dmaven.repo.local="$ORBIS_ELK_METADATA_REPO" clean install

cat > "$ORBIS_ELK_BUILD_DIR/metadata.init.gradle" <<'GRADLE'
allprojects {
  repositories {
    exclusiveContent {
      forRepository {
        maven {
          name = 'isolatedElkMetadata'
          url = uri(System.getenv('ORBIS_ELK_METADATA_REPO'))
        }
      }
      filter { includeGroup('org.eclipse.elk') }
    }
  }
}
GRADLE

cd "$ORBIS_ELK_BUILD_DIR/elkjs-ff5771d7165445c42c408bb8a090c8035272218c"
rm -rf lib build .gradle
./gradlew --no-daemon --init-script "$ORBIS_ELK_BUILD_DIR/metadata.init.gradle" \
  -PelkRepo="$ORBIS_ELK_BUILD_DIR/elk-323312916048544e4e594eab3303cdb0d01e2929" \
  copyPretty copyMinified
```

The isolated Maven settings avoid applying unrelated user repository mirrors. The Gradle init script only selects the freshly built local `org.eclipse.elk` metadata; the upstream source, version and generation tasks remain unchanged. It does not substitute a release JAR for the requested snapshot.

## Provenance limits

The recorded experiments completed the official metadata and worker generation paths. They did not modify a layout algorithm and test a rebuilt modification. The upstream publication did not record its historical ELK checkout. Generated workers differ from the published worker in synthetic class metadata, as detailed in the review record. These materials provide the official-version sources and demonstrated modification/build path; they do not claim historical environment reconstruction, byte-for-byte reproduction, complete observable equivalence or a legal guarantee. Orbis continues to deliver the original locked worker.
