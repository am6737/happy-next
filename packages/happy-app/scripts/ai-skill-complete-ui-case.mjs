import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Called inside an owned browser/API/DB/daemon harness after its account and
// local Git fixture have been created. The parent owns credential cleanup.
export async function runSkillP2UiCase({ page, api, outsiderApi, team, agent, tag, web,
    submitReadOnlyTask, awaitTaskCompletion, readTaskSkillSnapshot }) {
    const name = `${tag} skill`;
    const skillText1 = `# ${tag}\nRead support.txt exactly.\n`;
    const skillText2 = `# ${tag}\nRead support.txt and report v2.\n`;
    const support = Buffer.from(`${tag} support bytes\n`, 'utf8');
    const supportHash = createHash('sha256').update(support).digest('hex');
    const responses = [];
    page.on('response', (response) => {
        if (response.url().includes('/v1/ai-team/skills')) responses.push(response.status());
    });
    const mutation = async (method, path, status, action) => {
        const response = page.waitForResponse((candidate) =>
            candidate.request().method() === method && new URL(candidate.url()).pathname === path);
        await action();
        assert.equal((await response).status(), status, `${method} ${path}`);
    };
    const returnToSkill = async () => {
        await page.goto(`${web}/settings/skills`, { waitUntil: 'domcontentloaded' });
        const row = page.getByText(name, { exact: true }).first();
        await row.waitFor();
        await row.click();
        await page.getByText(`Team: ${team.name}`, { exact: true }).waitFor();
    };

    await page.goto(`${web}/settings/skills`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(team.name, { exact: true }).waitFor();
    await page.getByPlaceholder('Name').fill(name);
    await page.getByText(team.name, { exact: true }).click();
    await mutation('POST', '/v1/ai-team/skills', 201,
        () => page.getByText('Create', { exact: true }).click());
    const list = await api('/v1/ai-team/skills');
    assert.equal(list.status, 200);
    const skill = list.value.items.find((item) => item.name === name);
    assert.ok(skill);
    assert.equal(skill.teamId, team.id);
    assert.equal((await outsiderApi(`/v1/ai-team/skills/${skill.id}`)).status, 404);
    await page.getByText(name, { exact: true }).first().waitFor();
    await page.getByText(`Team: ${team.name}`, { exact: true }).waitFor();

    const addSupportFile = async () => {
        const chooser = page.waitForEvent('filechooser');
        await page.getByText('Add files', { exact: true }).click();
        await (await chooser).setFiles({ name: 'support.txt', mimeType: 'text/plain', buffer: support });
    };
    await page.getByPlaceholder('SKILL.md').fill(skillText1);
    await addSupportFile();
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/versions`, 201,
        () => page.getByText('Upload version', { exact: true }).click());
    const first = await api(`/v1/ai-team/skills/${skill.id}/versions/1`);
    assert.equal(first.status, 200);
    assert.equal(first.value.files.find((file) => file.path === 'support.txt')?.sha256, supportHash);
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/versions/1/publish`, 200, async () => {
        await page.getByText('Publish v1', { exact: true }).click();
        await page.getByText('Publish', { exact: true }).last().click();
    });
    await page.getByText(agent.name, { exact: true }).waitFor();
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/bindings`, 200,
        () => page.getByText(agent.name, { exact: true }).click());
    let detail = await api(`/v1/ai-team/skills/${skill.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.value.bindings.map((item) => item.agentId), [agent.id]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText(`Team: ${team.name}`, { exact: true }).waitFor();
    await page.getByText('Bound · current published v1', { exact: true }).waitFor();

    const oldTask = await submitReadOnlyTask({ agentId: agent.id, expectedText: support.toString('utf8') });
    const oldSnapshot = (await readTaskSkillSnapshot(oldTask)).find((item) => item.skillId === skill.id);
    assert.equal(oldSnapshot?.version, 1);
    assert.equal(oldSnapshot.contentHash, first.value.hash);
    assert.equal((await awaitTaskCompletion(oldTask)).answerVerified, true);
    await returnToSkill();

    await page.getByPlaceholder('SKILL.md').fill(skillText2);
    await addSupportFile();
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/versions`, 201,
        () => page.getByText('Upload version', { exact: true }).click());
    const second = await api(`/v1/ai-team/skills/${skill.id}/versions/2`);
    assert.equal(second.status, 200);
    assert.equal(second.value.files.find((file) => file.path === 'support.txt')?.sha256, supportHash);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText(`Team: ${team.name}`, { exact: true }).waitFor();
    await page.getByText('v2', { exact: false }).first().click();
    await page.getByText(skillText2, { exact: true }).waitFor();
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/versions/2/publish`, 200, async () => {
        await page.getByText('Publish', { exact: true }).first().click();
        await page.getByText('Publish', { exact: true }).last().click();
    });
    const newTask = await submitReadOnlyTask({ agentId: agent.id, expectedText: support.toString('utf8') });
    const newSnapshot = (await readTaskSkillSnapshot(newTask)).find((item) => item.skillId === skill.id);
    assert.equal(newSnapshot?.version, 2);
    assert.equal(newSnapshot.contentHash, second.value.hash);
    assert.equal((await awaitTaskCompletion(newTask)).answerVerified, true);
    assert.equal((await readTaskSkillSnapshot(oldTask)).find((item) => item.skillId === skill.id)?.version, 1);
    await returnToSkill();

    await page.getByText('v1', { exact: false }).first().click();
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/rollback`, 200, async () => {
        await page.getByText('Roll back', { exact: true }).first().click();
        await page.getByText('Roll back', { exact: true }).last().click();
    });
    detail = await api(`/v1/ai-team/skills/${skill.id}`);
    assert.equal(detail.value.currentVersion, 1);
    assert.equal((await readTaskSkillSnapshot(newTask)).find((item) => item.skillId === skill.id)?.version, 2);
    await page.getByPlaceholder('Suggestion for review').fill(`${tag} proposal`);
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/proposals`, 201,
        () => page.getByText('Submit proposal', { exact: true }).click());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText(`Team: ${team.name}`, { exact: true }).waitFor();
    await page.getByText(`${tag} proposal`, { exact: true }).waitFor();
    const proposals = await api(`/v1/ai-team/skills/${skill.id}/proposals`);
    assert.equal(proposals.status, 200);
    const pending = proposals.value.items.find((item) => item.text === `${tag} proposal`);
    assert.equal(pending?.status, 'pending');
    await mutation('POST', `/v1/ai-team/skills/${skill.id}/proposals/${pending.id}/review`, 200, async () => {
        await page.getByText('Reject', { exact: true }).first().click();
        await page.getByText('Reject', { exact: true }).last().click();
    });
    assert.equal((await api(`/v1/ai-team/skills/${skill.id}/proposals`)).value.items[0].status, 'rejected');
    assert.equal((await api(`/v1/ai-team/skills/${skill.id}`)).value.currentVersion, 1);
    await page.getByText(agent.name, { exact: true }).click();
    await page.getByText('Remove binding?', { exact: true }).waitFor();
    await page.getByText('Cancel', { exact: true }).last().click();
    detail = await api(`/v1/ai-team/skills/${skill.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.value.bindings.map((item) => item.agentId), [agent.id]);
    await page.getByText('Bound · current published v1', { exact: true }).waitFor();
    await mutation('DELETE', `/v1/ai-team/skills/${skill.id}/bindings/${agent.id}`, 204, async () => {
        await page.getByText(agent.name, { exact: true }).click();
        await page.getByText('Remove binding?', { exact: true }).waitFor();
        await page.getByText('OK', { exact: true }).last().click();
    });
    detail = await api(`/v1/ai-team/skills/${skill.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.value.bindings, []);
    await page.getByText(agent.name, { exact: true }).locator('..')
        .getByText('Not bound', { exact: true }).waitFor();
    assert.ok(responses.includes(201) && responses.includes(200));
    return { skillId: skill.id, oldTask, newTask, supportHash, apiStatuses: responses,
        cancelPreservedBinding: true, unboundThroughUi: true };
}
