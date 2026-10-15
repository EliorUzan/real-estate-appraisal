// Explicit versions keep future alias changes from changing an appraisal's model.
export const CLI_MODELS = [
  {id:'claude-opus-5-5',label:'Opus 5.5 · מאמץ גבוה',effort:'high'},
  {id:'claude-sonnet-5-5',label:'Sonnet 5.5 · מאמץ בינוני',effort:'medium'},
  {id:'claude-haiku-5-5',label:'Haiku 5.5 · מאמץ נמוך · לבדיקות קלות',effort:'low'},
  {id:'provider-default',label:'ברירת המחדל של החשבון',effort:null},
] as const;
export type CliModel = typeof CLI_MODELS[number]['id'];
export const DEFAULT_CLI_MODEL:CliModel = 'claude-opus-5-5';
export const isCliModel = (value:unknown):value is CliModel => CLI_MODELS.some(m=>m.id===value);
