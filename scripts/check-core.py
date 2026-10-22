#!/usr/bin/env python3
"""Compile and run the JVM safety suite without Gradle daemons or an Android SDK.

Requires JDK 17 and curl. Dependencies are downloaded from Maven Central to an
isolated cache; this also works in environments that prohibit listening sockets.
"""
import os
from pathlib import Path
import subprocess
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("SPACEKEEPER_TOOLS", ROOT / ".tools")) / "kotlin"
OUTPUT = ROOT / "core/build/standalone"
ARTIFACTS = [
    ("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.0.21"),
    ("org.jetbrains.kotlin", "kotlin-serialization-compiler-plugin-embeddable", "2.0.21"),
    ("org.jetbrains.kotlin", "kotlin-stdlib", "2.0.21"),
    ("org.jetbrains.kotlin", "kotlin-script-runtime", "2.0.21"),
    ("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10"),
    ("org.jetbrains.intellij.deps", "trove4j", "1.0.20200330"),
    ("org.jetbrains", "annotations", "13.0"),
    ("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.6.4"),
    ("org.jetbrains.kotlinx", "kotlinx-serialization-core-jvm", "1.7.3"),
    ("org.jetbrains.kotlinx", "kotlinx-serialization-json-jvm", "1.7.3"),
    ("org.jetbrains.kotlin", "kotlin-test", "2.0.21"),
    ("org.jetbrains.kotlin", "kotlin-test-junit", "2.0.21"),
    ("junit", "junit", "4.13.2"),
    ("org.hamcrest", "hamcrest-core", "1.3"),
]

def fetch(artifact):
    group, name, version = artifact
    filename = f"{name}-{version}.jar"
    destination = CACHE / filename
    if not destination.exists():
        url = f"https://repo.maven.apache.org/maven2/{group.replace('.', '/')}/{name}/{version}/{filename}"
        temporary = destination.with_suffix(".part")
        subprocess.run(["curl", "--fail", "--location", "--retry", "2", "--connect-timeout", "15",
                        "--max-time", "300", "--silent", "--show-error", url, "-o", str(temporary)], check=True)
        temporary.replace(destination)
    return destination

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        jars = list(pool.map(fetch, ARTIFACTS))
    java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in os.environ else "java"
    compiler = os.pathsep.join(map(str, jars))
    runtime = os.pathsep.join(str(p) for p in jars if "compiler" not in p.name)
    plugin = next(p for p in jars if "serialization-compiler" in p.name)
    sources = sorted((ROOT / "core/src").rglob("*.kt"))
    subprocess.run([java, "-Xmx2g", "-cp", compiler, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
                    "-no-stdlib", "-no-reflect", "-jvm-target", "17", "-classpath", runtime,
                    f"-Xplugin={plugin}", "-d", str(OUTPUT), *map(str, sources)], check=True)
    subprocess.run([java, "-cp", str(OUTPUT) + os.pathsep + runtime,
                    "org.junit.runner.JUnitCore", "cn.spacekeeper.core.SafetyTest", "cn.spacekeeper.core.FileIntegrationTest"], check=True)

if __name__ == "__main__":
    main()
