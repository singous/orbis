FROM jenkins/jenkins:2.580.1-jdk21@sha256:a660310e39ade10631f774bacd5219de767dfd08947ea5c32a739b5e5bb382c1
COPY --chmod=644 plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY --chmod=644 init.groovy /usr/share/jenkins/ref/init.groovy.d/orbis.groovy
