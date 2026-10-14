def withAccess(String credentialId, Closure action) {
    if (credentialId?.trim()) {
        withCredentials([usernamePassword(credentialsId: credentialId,
            usernameVariable: 'ORBIS_REGISTRY_USERNAME', passwordVariable: 'ORBIS_REGISTRY_PASSWORD')]) {
            action()
        }
    } else {
        action()
    }
}

return this
