const assert = require('node:assert/strict');
module.exports = async ({
  phase,
  evaluate,
  click,
  fill,
  until,
  checks,
  requests,
}) => {
  if (phase === 'scope-start') {
    assert.ok(
      (
        await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        )
      ).ok,
    );
    await fill('#live-prompt', 'synthetic portrait');
    await click('[data-testid=transparent-background]');
    await fill('#live-interval', '0');
    await fill('#live-repeats', '2');
    await click('[data-testid=scene-recipe] summary');
    await click('[data-testid=emotion-cuts] summary');
    for (const name of ['기쁨', '슬픔', '질투']) {
      await evaluate(`[...document.querySelectorAll('[data-testid=emotion-cuts] label')].find(label => label.textContent.includes(${JSON.stringify(name)})).querySelector('input').click()`);
    }
    await click('[data-testid=emotion-cuts] button');
    await click('[data-testid=prepare-recipe]');
    await until(() =>
      evaluate("!!document.querySelector('[data-testid=send-live-queue]')"),
    );
    assert.ok(await evaluate("document.querySelector('[data-testid=queue-confirm]').textContent.includes('투명 배경')"));
    await click('[data-testid=send-live-queue]');
    await until(
      async () =>
        requests() === 6 &&
        !(await evaluate('window.electron.generation.status()')).value.active,
    );
    const picks = await evaluate(`(async()=>{
      const api=window.electron.projects, id=(await api.list()).value[0].id;
      const {project,revision}=(await api.open(id)).value;
      const ids=['기쁨','슬픔'].map(name=>{
        const scene=project.scenes.find(s=>s.name.endsWith(name));
        return project.images.find(i=>i.sceneId===scene.id).id;
      });
      return api.setResultPicks(id,revision,ids,true);
    })()`);
    assert.ok(picks.ok);
    checks.push('completed three scenes twice and kept picks for two scenes');
  } else {
    await click('[data-testid=project-list]');
    await until(() =>
      evaluate("!!document.querySelector('[data-project-open]')"),
    );
    await click('[data-project-open]');
    await until(() =>
      evaluate(
        "document.querySelectorAll('[data-queue-scene]:checked').length===3",
      ),
    );
    await until(() =>
      evaluate(
        "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='선별 (2)');if(b)b.click();return !!b})()",
      ),
    );
    await until(() =>
      evaluate(
        "document.querySelector('[data-testid=prepare-unpicked]')?.textContent.includes('1개')",
      ),
    );
    assert.equal(requests(), 0);
    assert.ok(await evaluate("[...document.querySelectorAll('[aria-label=\"선별할 씬\"] option')].some(o=>o.textContent.includes('질투 · 생성 2장 · 선별 0장'))"));
    assert.ok((await evaluate("window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)")).ok);
    await click('[data-testid=prepare-unpicked]');
    await until(() => evaluate("!!document.querySelector('[data-testid=queue-confirm] li')"));
    assert.ok(await evaluate("[...document.querySelectorAll('[data-testid=queue-confirm] li')].every(row=>row.textContent.includes('질투'))"));
    assert.ok(await evaluate("document.querySelector('[data-testid=queue-confirm]').textContent.includes('투명 배경')"));
    await click('[data-testid=queue-confirm] button:last-of-type');
    assert.equal(requests(), 0);
    checks.push(
      'new process offers only the one missing scene without reselecting or sending',
    );
  }
};
