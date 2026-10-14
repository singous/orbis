import com.cloudbees.hudson.plugins.folder.Folder
import hudson.model.*
import hudson.plugins.git.*
import hudson.slaves.*
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition
import org.jenkinsci.plugins.workflow.job.WorkflowJob

def instance = Jenkins.get()
instance.setNumExecutors(0)
def location = JenkinsLocationConfiguration.get()
location.setUrl(System.getenv('ORBIS_JENKINS_URL'))
location.save()

def properties = instance.globalNodeProperties
def environment = properties.get(EnvironmentVariablesNodeProperty.class)
if (environment == null) {
    environment = new EnvironmentVariablesNodeProperty()
    properties.add(environment)
}
['ORBIS_SOURCE_REF', 'ORBIS_REPOSITORY', 'ORBIS_RUNTIME_DIR', 'ORBIS_ARTIFACT_ROOT', 'ORBIS_REGISTRY'].each {
    environment.envVars.put(it, System.getenv(it))
}

if (instance.getNode('orbis-builder') == null) {
    def agent = new DumbSlave('orbis-builder', 'Orbis build and deployment agent',
        System.getenv('ORBIS_AGENT_WORKDIR'), '1', Node.Mode.EXCLUSIVE, 'orbis-builder',
        new JNLPLauncher(true), new RetentionStrategy.Always(), [])
    instance.addNode(agent)
}
def bootstrap = new File('/run/orbis-bootstrap')
bootstrap.mkdirs()
def secret = new File(bootstrap, 'agent-secret')
secret.text = instance.getNode('orbis-builder').computer.jnlpMac
secret.setReadable(false, false)
secret.setReadable(true, true)

def folder = instance.getItem('orbis')
if (folder == null) {
    folder = instance.createProject(Folder.class, 'orbis')
}
def branch = System.getenv('ORBIS_SOURCE_REF') ?: 'develop'
['frontend': 'ci/Jenkinsfile.frontend', 'backend': 'ci/Jenkinsfile.backend',
 'release': 'ci/Jenkinsfile.release', 'rollback': 'ci/Jenkinsfile.rollback'].each { name, path ->
    def job = folder.getItem(name)
    if (job == null) {
        job = folder.createProject(WorkflowJob.class, name)
    }
    def scm = new GitSCM([new UserRemoteConfig(System.getenv('ORBIS_REPOSITORY'), null, null, null)],
        [new BranchSpec('*/' + branch)], false, [], null, null, [])
    def definition = new CpsScmFlowDefinition(scm, path)
    definition.setLightweight(true)
    job.setDefinition(definition)
    job.addProperty(new ParametersDefinitionProperty(
        new StringParameterDefinition('GIT_REF', branch, 'Trusted Git branch or complete commit'),
        new StringParameterDefinition('RELEASE_ID', '', 'Release identifier; blank creates a new identifier'),
        new BooleanParameterDefinition('DEPLOY', true, 'Deploy the tested release with Compose')
    ))
    job.setDescription('Orbis pipeline defined in Git. Images and manifests are retained for rollback.')
    job.save()
}
instance.save()
println('Orbis CI: four pipelines and the dedicated build agent are configured.')

def request = new File(bootstrap, 'run-release')
if (request.exists()) {
    def ref = request.text.trim() ?: branch
    request.delete()
    folder.getItem('release').scheduleBuild2(10,
        new CauseAction(new Cause.RemoteCause('local-bootstrap', 'Authorized Orbis environment deployment')),
        new ParametersAction(new StringParameterValue('GIT_REF', ref),
            new StringParameterValue('RELEASE_ID', ''), new BooleanParameterValue('DEPLOY', true)))
    println('Orbis CI: initial release queued.')
}
