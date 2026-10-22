#!/usr/bin/env python3
"""Build a debug APK with official SDK/ Kotlin CLI tools, without a Gradle daemon.

The normal supported workflow remains ./gradlew. This diagnostic build uses the
explicit Android dependency snapshot in android-dependencies.json. Requires JDK
17, Android platform 35, build tools 35.0.0, and command-line tools (manifest merger).
Caches are isolated under SPACEKEEPER_TOOLS (defaults to .tools).
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get("SPACEKEEPER_TOOLS", ROOT / ".tools"))
SDK = Path(os.environ.get("ANDROID_HOME", TOOLS / "android-sdk"))
JDK = Path(os.environ["JAVA_HOME"])
BUILD_TOOLS = SDK / "build-tools/35.0.0"
PLATFORM = SDK / "platforms/android-35/android.jar"
BUILD = ROOT / "app/build/standalone"
OUTPUT = ROOT / "output"
DEPS = TOOLS / "android-deps"
ANDROID = "http://schemas.android.com/apk/res/android"

def run(args):
    subprocess.run(list(map(str, args)), check=True)

def jar_dir(source, target):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source))

def main():
    for path in [BUILD_TOOLS / "aapt2", PLATFORM, JDK / "bin/java"]:
        if not path.exists():
            raise SystemExit(f"Missing prerequisite: {path}")
    BUILD.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(exist_ok=True)
    DEPS.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("core_check", ROOT / "scripts/check-core.py")
    core_check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(core_check)
    core_check.CACHE.mkdir(parents=True, exist_ok=True)
    compiler_jars = [core_check.fetch(artifact) for artifact in core_check.ARTIFACTS]
    artifacts = json.loads((ROOT / "scripts/android-dependencies.json").read_text())
    aar_dirs = []
    program_jars = []
    for dep in artifacts:
        group, name, version, ext = (dep[k] for k in ("g", "a", "v", "ext"))
        path = DEPS / f"{name}-{version}.{ext}"
        if not path.exists():
            base = "https://dl.google.com/dl/android/maven2" if group.startswith("androidx") else "https://repo.maven.apache.org/maven2"
            url = f"{base}/{group.replace('.', '/')}/{name}/{version}/{path.name}"
            partial = path.with_suffix(".part")
            run(["curl", "-fL", "--retry", "2", "--max-time", "300", "-sS", url, "-o", partial])
            partial.replace(path)
        if ext == "aar":
            extracted = BUILD / "aar" / path.stem
            with zipfile.ZipFile(path) as archive:
                archive.extractall(extracted)
            aar_dirs.append(extracted)
            if (extracted / "classes.jar").exists():
                program_jars.append(extracted / "classes.jar")
            program_jars.extend((extracted / "libs").glob("*.jar"))
        elif "compiler" not in name:
            program_jars.append(path)
    program_jars.extend(p for p in compiler_jars if p.name.startswith((
        "kotlin-stdlib-", "kotlinx-serialization-core-", "kotlinx-serialization-json-", "annotations-")))
    compiler_cp = os.pathsep.join(map(str, compiler_jars))
    java = JDK / "bin/java"
    serialization = TOOLS / "kotlin/kotlin-serialization-compiler-plugin-embeddable-2.0.21.jar"
    compose = DEPS / "kotlin-compose-compiler-plugin-embeddable-2.0.21.jar"
    classes = BUILD / "classes"
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir()
    sources = sorted((ROOT / "core/src/main").rglob("*.kt")) + sorted((ROOT / "app/src/main/java").rglob("*.kt"))
    run([java, "-Xmx3g", "-cp", compiler_cp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
         "-jvm-target", "17", "-classpath", os.pathsep.join(map(str, [PLATFORM, *program_jars])),
         f"-Xplugin={serialization}", f"-Xplugin={compose}", "-d", classes, *sources])
    print("Kotlin, Compose and serialization compilation passed.", flush=True)

    # Merge real dependency manifests using the Android SDK merger.
    manifest = ET.parse(ROOT / "app/src/main/AndroidManifest.xml")
    ET.register_namespace("android", ANDROID)
    manifest.getroot().set("package", "cn.spacekeeper.app")
    manifest.getroot().set(f"{{{ANDROID}}}versionCode", "1")
    manifest.getroot().set(f"{{{ANDROID}}}versionName", "0.1.0")
    manifest.getroot().find("application").set(f"{{{ANDROID}}}debuggable", "true")
    manifest.getroot().insert(0, ET.Element("uses-sdk", {f"{{{ANDROID}}}minSdkVersion": "26", f"{{{ANDROID}}}targetSdkVersion": "35"}))
    main_manifest = BUILD / "MainManifest.xml"
    manifest.write(main_manifest, encoding="utf-8", xml_declaration=True)
    sdk_jars = list((SDK / "cmdline-tools/latest/lib").rglob("*.jar"))
    merger_cp = os.pathsep.join(map(str, sdk_jars))
    merger_classes = BUILD / "merger"
    merger_classes.mkdir(exist_ok=True)
    run([JDK / "bin/javac", "-cp", merger_cp, "-d", merger_classes, ROOT / "scripts/MergeManifest.java"])
    merged = BUILD / "AndroidManifest.xml"
    library_manifests = [d / "AndroidManifest.xml" for d in aar_dirs if (d / "AndroidManifest.xml").exists()]
    run([java, "-cp", str(merger_classes) + os.pathsep + merger_cp, "MergeManifest", main_manifest, merged, *library_manifests])

    aapt = BUILD_TOOLS / "aapt2"
    compiled = []
    packages = []
    for index, directory in enumerate(aar_dirs + [ROOT / "app/src/main"]):
        res = directory / "res"
        if res.exists() and any(res.rglob("*.xml")):
            target = BUILD / f"resources-{index}.zip"
            run([aapt, "compile", "--dir", res, "-o", target])
            compiled.append(target)
        if (directory / "AndroidManifest.xml").exists():
            package = ET.parse(directory / "AndroidManifest.xml").getroot().get("package")
            if package:
                packages.append(package)
    generated = BUILD / "generated"
    generated.mkdir(exist_ok=True)
    resource_apk = BUILD / "resources.apk"
    link = [aapt, "link", "-I", PLATFORM, "--manifest", merged, "--java", generated, "--auto-add-overlay",
            "--extra-packages", ":".join(sorted(set(packages))), "--min-sdk-version", "26", "--target-sdk-version", "35",
            "-o", resource_apk]
    for resource in compiled:
        link.extend(["-R", resource])
    run(link)
    generated_sources = sorted(generated.rglob("*.java"))
    run([JDK / "bin/javac", "--release", "17", "-d", classes, *generated_sources])
    own_jar = BUILD / "app-classes.jar"
    jar_dir(classes, own_jar)
    dex = BUILD / "dex"
    if dex.exists():
        shutil.rmtree(dex)
    dex.mkdir(exist_ok=True)
    run([java, "-Xmx3g", "-cp", BUILD_TOOLS / "lib/d8.jar", "com.android.tools.r8.D8",
         "--min-api", "26", "--lib", PLATFORM, "--output", dex, own_jar, *program_jars])

    unsigned = BUILD / "unsigned.apk"
    shutil.copyfile(resource_apk, unsigned)
    services = {}
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as apk:
        added = set(apk.namelist())
        for path in sorted(dex.glob("*.dex")):
            apk.write(path, path.name)
            added.add(path.name)
        for jar in program_jars:
            with zipfile.ZipFile(jar) as archive:
                for name in archive.namelist():
                    if name.startswith("META-INF/services/") and not name.endswith("/"):
                        services.setdefault(name, set()).update(archive.read(name).decode().splitlines())
                    elif not name.endswith(("/", ".class")) and not name.startswith("META-INF/") and name not in added:
                        # Includes OkHttp's public-suffix database and Kotlin built-in resources.
                        apk.writestr(name, archive.read(name)); added.add(name)
        for name, entries in services.items():
            apk.writestr(name, "\n".join(sorted(entries)) + "\n")
        added = set(apk.namelist())
        for directory in aar_dirs:
            for subdir, apk_prefix in [("jni", "lib"), ("assets", "assets")]:
                source = directory / subdir
                if source.exists():
                    for path in sorted(source.rglob("*")):
                        name = f"{apk_prefix}/{path.relative_to(source)}"
                        if path.is_file() and name not in added:
                            apk.write(path, name); added.add(name)
    aligned = BUILD / "aligned.apk"
    run([BUILD_TOOLS / "zipalign", "-f", "-P", "16", "4", unsigned, aligned])
    keystore = TOOLS / "spacekeeper-debug.keystore"
    if not keystore.exists():
        run([JDK / "bin/keytool", "-genkeypair", "-keystore", keystore, "-storepass", "android", "-keypass", "android",
             "-alias", "androiddebugkey", "-dname", "CN=Android Debug,O=Android,C=US", "-keyalg", "RSA", "-validity", "3650"])
    apk = OUTPUT / "spacekeeper-debug.apk"
    signer = BUILD_TOOLS / "lib/apksigner.jar"
    run([java, "-jar", signer, "sign", "--ks", keystore, "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", apk, aligned])
    run([java, "-jar", signer, "verify", "--verbose", apk])
    run([BUILD_TOOLS / "zipalign", "-c", "-P", "16", "4", apk])
    print(f"Built and signature-verified: {apk}\nDevice execution has NOT been verified.")

if __name__ == "__main__":
    main()
