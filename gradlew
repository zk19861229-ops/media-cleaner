#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${JAVA_HOME:-}" ]; then
  JAVA_COMMAND="$JAVA_HOME/bin/java"
else
  JAVA_COMMAND=java
fi
exec "$JAVA_COMMAND" -classpath "$APP_DIR/gradle/wrapper/gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain "$@"
