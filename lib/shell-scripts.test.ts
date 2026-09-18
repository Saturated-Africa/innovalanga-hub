import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * The shell scripts, checked for the ways they have actually broken.
 *
 * Every one of these is a failure that already happened here, and each was
 * expensive to diagnose because the symptom pointed somewhere else.
 *
 * A carriage return in a script makes its shebang unexecutable, and the error
 * is "No such file or directory" naming a file that plainly exists. That sends
 * everybody looking for a missing file.
 *
 * An escape that lost its backslash - `tr -d ''` where `tr -d '\r'` was meant,
 * or `sed 's/$//'` where `sed 's/\r$//'` was meant - is worse, because it does
 * not fail at all. It silently stops doing the thing it was added to do, and
 * the script carries on looking correct. That is how a carriage return survived
 * into a deployed script whose whole job was to remove carriage returns.
 *
 * These are cheap to check and the checks do not depend on anyone remembering.
 */

const SHELL_DIRS = ['infra', 'scripts']

async function shellScripts(): Promise<{ path: string; source: string }[]> {
  const found: { path: string; source: string }[] = []
  for (const dir of SHELL_DIRS) {
    let entries: string[]
    try {
      entries = await readdir(path.join(process.cwd(), dir))
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.sh')) continue
      const full = path.join(process.cwd(), dir, name)
      found.push({ path: `${dir}/${name}`, source: await readFile(full, 'utf8') })
    }
  }
  return found
}

test('there are shell scripts to check', async () => {
  const scripts = await shellScripts()
  assert.ok(scripts.length >= 3, `only found ${scripts.length}`)
})

test('no script contains a carriage return', async () => {
  const offenders: string[] = []
  for (const { path: p, source } of await shellScripts()) {
    if (source.includes('\r')) {
      const line = source.slice(0, source.indexOf('\r')).split('\n').length
      offenders.push(`${p}:${line}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a carriage return makes the shebang unexecutable, and the error names a file ' +
      `that exists: ${offenders.join(', ')}`
  )
})

test('no escape has lost its backslash', async () => {
  // The signatures of the specific mistake: an empty deletion set, or a
  // substitution that matches the end of a line and replaces it with nothing.
  const BROKEN = [
    { pattern: /tr\s+-d\s+''/, meant: "tr -d '\\r'" },
    { pattern: /sed\s+'s\/\$\/\/'/, meant: "sed 's/\\r$//'" },
    { pattern: /tr\s+-d\s+'\\?n'\s*\)/, meant: "tr -d '\\r\\n'" },
  ]
  const offenders: string[] = []
  for (const { path: p, source } of await shellScripts()) {
    source.split('\n').forEach((line, i) => {
      for (const { pattern, meant } of BROKEN) {
        if (pattern.test(line)) offenders.push(`${p}:${i + 1} looks like ${meant} with the backslash lost`)
      }
    })
  }
  assert.deepEqual(offenders, [], offenders.join('; '))
})

test('every script declares an interpreter', async () => {
  const offenders: string[] = []
  for (const { path: p, source } of await shellScripts()) {
    if (!source.startsWith('#!')) offenders.push(p)
  }
  assert.deepEqual(offenders, [], `no shebang: ${offenders.join(', ')}`)
})

test('every script sets its safety flags', async () => {
  /*
   * `set -e` is not demanded of every script, deliberately.
   *
   * The restore and TLS scripts run steps that are expected to fail and are
   * handled explicitly - a certificate that does not arrive, a programme with
   * no allocation - and under `set -e` the first of those would abort the
   * script half way through, leaving the site down with no rollback. They use
   * `set -uo pipefail` and check each result.
   *
   * What every script must have is `-u` and `pipefail`. An unset variable
   * expanding to nothing is how a path becomes `/` and a loop deletes the wrong
   * thing, and without `pipefail` a failed command in the middle of a pipeline
   * is invisible.
   */
  const offenders: string[] = []
  for (const { path: p, source } of await shellScripts()) {
    const line = source.split(String.fromCharCode(10)).find((l) => /^set\s+-/.test(l))
    if (!line) {
      offenders.push(`${p}: no set line at all`)
      continue
    }
    if (!/u/.test(line.split(/\s+/)[1] ?? '')) offenders.push(`${p}: missing -u`)
    if (!/pipefail/.test(line)) offenders.push(`${p}: missing pipefail`)
  }
  assert.deepEqual(offenders, [], offenders.join('; '))
})
