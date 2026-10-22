@echo off
set DIR=%~dp0
if defined JAVA_HOME (set "JAVA_COMMAND=%JAVA_HOME%\bin\java.exe") else (set "JAVA_COMMAND=java.exe")
"%JAVA_COMMAND%" -classpath "%DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
