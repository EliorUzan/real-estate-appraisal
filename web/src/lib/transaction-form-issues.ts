export function transactionFormIssues(value:Record<string,string>,automatic=false){
 const issues:string[]=[];
 for(const [key,label,min,max,integer,required] of [
  ['rooms','מספר חדרים',.5,100,false,false],['area','שטח הנכס',.1,1000000,false,false],
  ['radius','רדיוס חיפוש',1,5000,true,false],['limit','מספר עסקאות',1,40,true,true],
  ...(automatic?[['pages','מספר עמודים לאיסוף',1,20,true,true]]:[]) ] as [string,string,number,number,boolean,boolean][]){
  const raw=value[key]??'';
  if(!raw.trim()){if(required)issues.push('יש להזין '+label+'.');continue;}
  const n=Number(raw);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isInteger(n))issues.push(`${label} חייב להיות ${integer?'מספר שלם':'מספר'} בין ${min} ל־${max}.`);
 }
 for(const key of ['startDate','endDate']){
  const date=value[key];if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))))issues.push('יש להזין תאריך תקין.');
 }
 if(value.startDate&&value.endDate&&value.startDate>value.endDate)issues.push('תאריך ההתחלה מאוחר מתאריך הסיום.');
 return issues;
}
