#!/usr/bin/env python3
# O `gh` de mentira do release.test.sh: só entende `gh api` nas formas que o publish-release.sh usa, e faz o que a documentação
# da API de releases do GitHub diz (o rascunho não tem tag; publicar cria a tag no `target_commitish`, ou usa a que já existe; um
# anexo com o mesmo nome é recusado; o envio que falha no caminho pode deixar um anexo vazio, em estado "starter"; a release de um
# commit que acrescenta ou muda arquivos de .github/workflows/ em relação ao ramo padrão responde 404 ao GITHUB_TOKEN).
#
# Estado na pasta $FAKE: releases.json (a lista), calls (uma linha por pedido: "MÉTODO código endereço"), gh.argv (os argumentos
# de cada chamada) e uploads (o nome de cada anexo recebido). As falhas de cada caso são arquivos em $FAKE (veja `flag`).
# O "remoto" das tags é o repositório bare $FAKE_REMOTE. Nenhum endereço de verdade: tudo é .invalid.
import json
import os
import re
import subprocess
import sys

FAKE = os.environ["FAKE"]
REMOTE = os.environ["FAKE_REMOTE"]
REPO = os.environ["FAKE_REPO"]
UPLOAD = os.environ["FAKE_UPLOAD"]
TOKEN = os.environ["FAKE_TOKEN"]
GIT = os.environ.get("REAL_GIT", "git")


def path(name):
    return os.path.join(FAKE, name)


def flag(name):
    return os.path.exists(path(name))


def flag_value(name):
    try:
        with open(path(name)) as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return None


def load():
    try:
        with open(path("releases.json")) as handle:
            return json.load(handle)
    except FileNotFoundError:
        return []


def save(releases):
    with open(path("releases.json"), "w") as handle:
        json.dump(releases, handle, indent=1)


def next_id(kind):
    counter = path(f"next-{kind}-id")
    try:
        with open(counter) as handle:
            value = int(handle.read())
    except FileNotFoundError:
        value = 101 if kind == "release" else 1001
    with open(counter, "w") as handle:
        handle.write(str(value + 1))
    return value


def git(*args):
    return subprocess.run([GIT, "-C", REMOTE, *args], capture_output=True, text=True)


def tag_commit(tag):
    if git("show-ref", "--verify", "--quiet", f"refs/tags/{tag}").returncode != 0:
        return None
    return git("rev-parse", f"refs/tags/{tag}^{{commit}}").stdout.strip()


def touches_workflows(target):
    head = git("symbolic-ref", "HEAD").stdout.strip()
    default = git("rev-parse", head).stdout.strip()
    diff = git("diff", "--name-only", "--diff-filter=AM", default, target, "--", ".github/workflows")
    return diff.returncode != 0 or diff.stdout.strip() != ""


def respond(code, body, endpoint, method):
    with open(path("calls"), "a") as handle:
        handle.write(f"{method} {code} {endpoint}\n")
    if body is not None:
        sys.stdout.write(json.dumps(body))
    if code >= 400:
        sys.stderr.write(f"gh: {body.get('message', 'erro') if isinstance(body, dict) else 'erro'} (HTTP {code})\n")
        sys.exit(1)
    sys.exit(0)


def main():
    argv = sys.argv[1:]
    with open(path("gh.argv"), "a") as handle:
        handle.write(" ".join(argv) + "\n")
    if not argv or argv[0] != "api":
        sys.stderr.write("gh de mentira: só `gh api`\n")
        sys.exit(2)
    method, headers, input_file, endpoint = "GET", [], None, None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg in ("--method", "-X"):
            method = rest[i + 1]
            i += 2
        elif arg in ("-H", "--header"):
            headers.append(rest[i + 1])
            i += 2
        elif arg == "--input":
            input_file = rest[i + 1]
            i += 2
        elif arg.startswith("-"):
            sys.stderr.write(f"gh de mentira: opção que o ensaio não conhece: {arg}\n")
            sys.exit(2)
        else:
            endpoint = arg
            i += 1
    if os.environ.get("GH_TOKEN") != TOKEN:
        respond(401, {"message": "Bad credentials"}, endpoint, method)
    config = os.environ.get("GH_CONFIG_DIR", "")
    if not config or not os.path.isdir(config) or os.listdir(config):
        respond(400, {"message": "o gh de mentira exige uma pasta de configuração própria e vazia (GH_CONFIG_DIR)"}, endpoint, method)
    for variable in ("GH_DEBUG", "DEBUG", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"):
        if os.environ.get(variable):
            respond(400, {"message": f"o gh de mentira recusa {variable} no ambiente"}, endpoint, method)

    releases = load()
    body = None
    if input_file is not None and not endpoint.startswith(UPLOAD):
        with open(input_file) as handle:
            body = json.load(handle)

    base = f"repos/{REPO}/releases"
    match_page = re.fullmatch(re.escape(base) + r"\?per_page=100&page=(\d+)", endpoint)
    match_id = re.fullmatch(re.escape(base) + r"/(\d+)", endpoint)
    match_tag = re.fullmatch(re.escape(base) + r"/tags/(.+)", endpoint)
    match_asset = re.fullmatch(re.escape(base) + r"/assets/(\d+)", endpoint)
    match_upload = re.fullmatch(re.escape(f"{UPLOAD}/repos/{REPO}/releases/") + r"(\d+)/assets\?name=([A-Za-z0-9._-]+)", endpoint)

    if method == "GET" and match_page:
        if flag("lista-falha") or (flag("lista-falha-uma-vez") and not flag("lista-ja-falhou")):
            open(path("lista-ja-falhou"), "w").close()
            respond(502, {"message": "Bad Gateway"}, endpoint, method)
        page = int(match_page.group(1))
        ordered = sorted(releases, key=lambda r: -r["id"])
        respond(200, ordered[(page - 1) * 100 : page * 100], endpoint, method)

    if method == "GET" and match_id:
        found = [r for r in releases if r["id"] == int(match_id.group(1))]
        if not found:
            respond(404, {"message": "Not Found"}, endpoint, method)
        respond(200, found[0], endpoint, method)

    if method == "GET" and match_tag:
        found = [r for r in releases if r["tag_name"] == match_tag.group(1) and not r["draft"]]
        if not found:
            respond(404, {"message": "Not Found"}, endpoint, method)
        respond(200, found[0], endpoint, method)

    if method == "POST" and endpoint == base:
        if flag("cria-falha-500"):
            respond(500, {"message": "Server Error"}, endpoint, method)
        if touches_workflows(body.get("target_commitish", "")):
            respond(404, {"message": "Not Found"}, endpoint, method)
        if not body.get("draft"):
            respond(422, {"message": "o ensaio só cria rascunho"}, endpoint, method)
        new_id = next_id("release")
        release = {
            "id": new_id,
            "tag_name": body["tag_name"],
            "target_commitish": body["target_commitish"],
            "name": body.get("name"),
            "body": body.get("body"),
            "draft": True,
            "prerelease": bool(body.get("prerelease")),
            "immutable": False,
            "upload_url": f"{UPLOAD}/repos/{REPO}/releases/{new_id}/assets{{?name,label}}",
            "assets": [],
        }
        releases.append(release)
        save(releases)
        respond(502 if flag("cria-e-responde-502") else 201, release, endpoint, method)

    if method == "PATCH" and match_id:
        found = [r for r in releases if r["id"] == int(match_id.group(1))]
        if not found:
            respond(404, {"message": "Not Found"}, endpoint, method)
        release = found[0]
        if touches_workflows(body.get("target_commitish", release["target_commitish"])):
            respond(404, {"message": "Not Found"}, endpoint, method)
        publishing = release["draft"] and body.get("draft") is False
        if publishing and flag("publica-recusa-403"):
            respond(403, {"message": "Resource not accessible by integration"}, endpoint, method)
        for key in ("name", "body", "prerelease", "target_commitish", "tag_name"):
            if key in body:
                release[key] = body[key]
        if publishing:
            if tag_commit(release["tag_name"]) is None:
                git("update-ref", f"refs/tags/{release['tag_name']}", release["target_commitish"])
            release["draft"] = False
            release["immutable"] = flag("imutavel")
            release["make_latest"] = body.get("make_latest")
        save(releases)
        respond(502 if (publishing and flag("publica-e-responde-502")) else 200, release, endpoint, method)

    if method == "DELETE" and match_id:
        kept = [r for r in releases if r["id"] != int(match_id.group(1))]
        if len(kept) == len(releases):
            respond(404, {"message": "Not Found"}, endpoint, method)
        save(kept)
        respond(204, None, endpoint, method)

    if method == "DELETE" and match_asset:
        asset_id = int(match_asset.group(1))
        for release in releases:
            for asset in release["assets"]:
                if asset["id"] == asset_id:
                    if not release["draft"] and release["immutable"]:
                        respond(422, {"message": "imutável"}, endpoint, method)
                    release["assets"].remove(asset)
                    save(releases)
                    respond(204, None, endpoint, method)
        respond(404, {"message": "Not Found"}, endpoint, method)

    if method == "POST" and match_upload:
        release_id, name = int(match_upload.group(1)), match_upload.group(2)
        found = [r for r in releases if r["id"] == release_id]
        if not found:
            respond(404, {"message": "Not Found"}, endpoint, method)
        release = found[0]
        if not release["draft"] and release["immutable"]:
            respond(422, {"message": "imutável"}, endpoint, method)
        if "Content-Type: application/octet-stream" not in headers:
            respond(400, {"message": "sem Content-Type"}, endpoint, method)
        if any(a["name"] == name for a in release["assets"]):
            respond(422, {"message": "Validation Failed", "errors": [{"code": "already_exists"}]}, endpoint, method)
        with open(path("uploads"), "a") as handle:
            handle.write(name + "\n")
        if flag_value("upload-falha") == name:
            respond(500, {"message": "Server Error"}, endpoint, method)
        import hashlib

        with open(input_file, "rb") as handle:
            data = handle.read()
        asset_id = next_id("asset")
        broken = flag_value("upload-grava-e-502") == name
        asset = {
            "id": asset_id,
            "name": name,
            "state": "starter" if broken else "uploaded",
            "size": 0 if broken else len(data),
            "digest": None if (broken or flag("sem-digest")) else "sha256:" + hashlib.sha256(data).hexdigest(),
        }
        release["assets"].append(asset)
        save(releases)
        respond(502 if broken else 201, asset, endpoint, method)

    sys.stderr.write(f"gh de mentira: pedido que o ensaio não conhece: {method} {endpoint}\n")
    sys.exit(2)


main()
