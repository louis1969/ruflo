# Publishing Checklist

Step-by-step checklist for cutting a release of `ruflo` to npm.

---

## Before every release

### 1. Code quality

- [ ] `npm run typecheck` — zero TypeScript errors
- [ ] `npm run build` — `dist/` compiles cleanly
- [ ] `node dist/cli.js --help` — CLI binary resolves and prints help
- [ ] `node -e "import('./dist/index.js').then(m => console.log(Object.keys(m)))"` — library exports resolve

### 2. Package shape

- [ ] `package.json` `version` is bumped (see [Version bump](#version-bump))
- [ ] `package.json` `exports` map covers all public deep-import paths
- [ ] `package.json` `files` lists only `["dist", "README.md"]` — no source, no `.ruflo/` state
- [ ] `dist/cli.js` first line is `#!/usr/bin/env node` (shebang survived the build)

```bash
head -1 dist/cli.js    # must print: #!/usr/bin/env node
```

- [ ] No secrets in `dist/` — scan for leaked API keys

```bash
grep -r "sk-ant\|sk-proj\|gsk_\|AIza" dist/ && echo "FOUND SECRETS" || echo "clean"
```

### 3. Dry run

```bash
npm pack --dry-run
```

Review the file list. Expected contents:

```
dist/
  cli.js
  cli.d.ts
  index.js
  index.d.ts
  core/
  mcp/
  commands/
  cli/
  types/
README.md
package.json
```

Nothing outside `dist/` and `README.md` should be present (no `src/`, no `.ruflo/`, no `.env`).

### 4. Changelog

- [ ] `CHANGELOG.md` updated with the new version, date, and a bullet list of changes
- [ ] Breaking changes called out with **BREAKING** prefix

---

## Version bump

Follow [Semantic Versioning](https://semver.org):

| Change type | Bump |
|-------------|------|
| Bug fix, documentation | `patch` — `0.1.0 → 0.1.1` |
| New feature, non-breaking | `minor` — `0.1.0 → 0.2.0` |
| Breaking API change | `major` — `0.1.0 → 1.0.0` |

```bash
# pick one:
npm version patch
npm version minor
npm version major
```

`npm version` updates `package.json`, commits the change, and creates a git tag automatically.

Or bump manually:

```bash
# 1. Edit version in package.json
# 2. git add package.json
# 3. git commit -m "chore: release v0.2.0"
# 4. git tag v0.2.0
```

---

## Publish

### First-time setup

```bash
npm login          # authenticates to registry.npmjs.org
npm whoami         # verify you are logged in
```

### Publish to npm

```bash
# Dry run first — no files are uploaded
npm publish --dry-run --access public

# Real publish
npm publish --access public
```

`prepublishOnly` in `package.json` runs `npm run build` automatically before upload.

### Publish a pre-release (beta/alpha)

```bash
npm version 0.2.0-beta.1
npm publish --tag beta --access public

# Consumers install it with:
npm install ruflo@beta
```

---

## Post-publish verification

```bash
# Wait ~30 seconds for the registry to propagate, then:
npm view ruflo
npm view ruflo@0.x.x

# Install from registry into a temp directory and smoke-test
cd /tmp && mkdir ruflo-smoke && cd ruflo-smoke
npm init -y
npm install ruflo@latest
node -e "import('ruflo').then(m => console.log('ok:', Object.keys(m).length, 'exports'))"
npx ruflo --help
```

---

## Git housekeeping

```bash
# Push the version commit and tag created by npm version
git push origin main
git push origin --tags
```

Create a GitHub release:

1. Go to **Releases → Draft a new release**
2. Select the `vX.Y.Z` tag
3. Title: `vX.Y.Z`
4. Body: paste the relevant section from `CHANGELOG.md`
5. If pre-release, check **This is a pre-release**
6. Click **Publish release**

---

## Rollback

If a bad version was published:

```bash
# Deprecate (preferred — keeps the version but warns installers)
npm deprecate ruflo@0.2.0 "Critical bug — use 0.2.1 instead"

# Unpublish (only within 72 hours and only if no dependents)
npm unpublish ruflo@0.2.0
```

---

## Pre-publish quick-command sequence

Copy-paste this block to run all checks in one go:

```bash
npm run typecheck \
  && npm run build \
  && head -1 dist/cli.js \
  && node dist/cli.js --help > /dev/null \
  && node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m).length,'exports ok'))" \
  && grep -r "sk-ant\|sk-proj\|gsk_\|AIza" dist/ && echo "SECRETS FOUND — abort" || true \
  && npm pack --dry-run \
  && echo "\n✓ all checks passed — ready to publish"
```
