const assert = require('node:assert/strict');
const { mergeConcurrentState } = require('./logic.js');
const state = (advances) => ({ version: 15, employees: [], entries: [], advances });
const base = state([{ id: 'old', value: 10, status: 'pending' }]);
const a = state([...base.advances, { id: 'notebook-a', value: 20 }]);
const b = state([...base.advances, { id: 'notebook-b', value: 30 }]);
const merged = mergeConcurrentState(base, b, a);
assert.equal(merged.advances.length, 3);
assert.equal(merged.advances.reduce((total, row) => total + row.value, 0), 60);
assert.equal(mergeConcurrentState(base, b, merged).advances.length, 3);
assert.equal(mergeConcurrentState(base, state([]), a).advances.some(row => row.id === 'old'), true);
assert.equal(mergeConcurrentState(base, base, state([])).advances.length, 1);
assert.equal(mergeConcurrentState(base, {...state([]), deletedAdvances:['old']}, a).advances.some(row => row.id === 'old'), false);
assert.equal(mergeConcurrentState(base, a, {...state([]), deletedAdvances:['old']}).advances.some(row => row.id === 'old'), false);
assert.equal(mergeConcurrentState(base, state([]), state([])).advances.length, 1);
const edited = mergeConcurrentState(base, state([{...base.advances[0], value: 15}]), state([{...base.advances[0], status: 'paid'}]));
assert.equal(edited.advances[0].value, 15);
assert.equal(edited.advances[0].status, 'paid');
assert.equal(mergeConcurrentState(null, a, b).advances.length, 3);
assert.deepEqual(base.advances, [{id:'old',value:10,status:'pending'}]);
console.log('Sincronização: vales de dois notebooks, repetição, exclusões e edição simultânea passaram.');
const fourDates = state(['09', '10', '11', '13'].map(day => ({ id: `nov-${day}`, date: `2026-11-${day}`, value: 18, status: 'pending' })));
assert.equal(mergeConcurrentState(fourDates, fourDates, state([])).advances.length, 4);
assert.equal(mergeConcurrentState(fourDates, state([]), fourDates).advances.length, 4);
assert.equal(mergeConcurrentState(fourDates, state([]), state([])).advances.length, 4);
console.log('Regressão de 09, 10, 11 e 13/11: lista incompleta não exclui vales conhecidos.');

for (const [collection, deletionKey] of [["employees", "deletedEmployees"], ["entries", "deletedEntries"]]) {
  const original = { ...state([]), [collection]: [{ id: 'keep', name: 'Original' }] };
  const incomplete = state([]);
  assert.equal(mergeConcurrentState(original, incomplete, original)[collection].length, 1);
  assert.equal(mergeConcurrentState(original, original, incomplete)[collection].length, 1);
  assert.equal(mergeConcurrentState(original, incomplete, incomplete)[collection].length, 1);
  const deleted = { ...incomplete, [deletionKey]: ['keep'] };
  assert.equal(mergeConcurrentState(original, deleted, original)[collection].length, 0);
  assert.equal(mergeConcurrentState(original, original, deleted)[collection].length, 0);
  assert.equal(mergeConcurrentState(deleted, original, incomplete)[collection].length, 0);
}
console.log('Jornadas, faltas e colaboradores: cópias incompletas preservadas; exclusões explícitas propagadas.');

const deletedEmployee = { ...state([]), deletedEmployees: ['employee'] };
const staleEmployee = { ...state([{id:'new-advance',employeeId:'employee'}]), employees:[{id:'employee'}], entries:[{id:'new-entry',employeeId:'employee'}] };
const noOrphans = mergeConcurrentState(null, staleEmployee, deletedEmployee);
assert.equal(noOrphans.employees.length, 0);
assert.equal(noOrphans.entries.length, 0);
assert.equal(noOrphans.advances.length, 0);
const currentBackup = state([{id:'original',value:10},{id:'another-notebook',value:20}]);
const importedBackup = state([{id:'original',value:15}]);
const restored = mergeConcurrentState(currentBackup, importedBackup, currentBackup);
assert.equal(restored.advances.length, 2);
assert.equal(restored.advances.find(row => row.id === 'original').value, 15);
console.log('Backup mesclado preserva lançamentos ausentes; exclusão de colaborador não deixa registros órfãos.');

// Every employee must keep all advances when three notebooks save independently.
const roster = Array.from({length: 90}, (_, index) => ({id: `employee-${index}`, name: `Colaborador ${index}`}));
const common = {...state([]), employees: roster};
const devices = ['Vitoria', 'Notebook 2', 'Notebook 3'].map((author, notebook) => ({
  ...common,
  advances: roster.flatMap(employee => ['09','10','11','13'].map(day => ({
    id: `${employee.id}-${notebook}-${day}`, employeeId: employee.id,
    date: `2026-11-${day}`, value: 18, status: 'pending', createdBy: {name: author}
  })))
}));
for (const order of [[0,1,2],[2,0,1],[1,2,0]]) {
  let result = common;
  for (const device of order) result = mergeConcurrentState(common, devices[device], result);
  assert.equal(result.employees.length, 90);
  for (const employee of roster) {
    const advances = result.advances.filter(row => row.employeeId === employee.id);
    assert.equal(advances.length, 12);
    assert.equal(advances.reduce((total, row) => total + row.value, 0), 216);
    assert.equal(advances.filter(row => row.createdBy.name === 'Vitoria').length, 4);
  }
  assert.equal(mergeConcurrentState(common, result, result).advances.length, 1080);
}
console.log('90 colaboradores simulados, três notebooks e 1.080 vales: quantidades, autoria e totais preservados.');
