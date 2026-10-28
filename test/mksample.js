const S=["The rain had not stopped for three days, and the river beside the old market was rising faster than anyone wanted to admit.",
"\"We can't stay here,\" Amaka said, pulling her wrapper tighter against the wind.",
"Her brother looked at the sky as if it owed him an explanation -- then he laughed, because there was nothing else to do.",
"Nobody in the village remembered a storm like this one... not even Mama Ngozi, who remembered everything.",
"They walked past the shuttered shops, the *silent* radio stalls, and the church whose bell had rung all night.",
"It was **extraordinary**, the way ordinary people became brave when there was no other choice.",
"'Tell me what you saw,' the old man whispered, and for a long moment no one answered him.",
"By morning the water had reached the third step of the schoolhouse, and the children were counting the steps that remained."];
let out="# The River Remembers\n\nby Jones Jnr\n\n";
const names=["Chapter 1: The Storm","Chapter 2: Market Day","Chapter 3","Chapter 4: The Bell","Chapter 5: What the Water Took","Chapter 6","Chapter 7: Home"];
let k=0;
for(const n of names){out+=`# ${n}\n\n`;const paras=25+((k*7)%15);for(let p=0;p<paras;p++){let s=[];const len=2+((p*5+k)%6);for(let j=0;j<len;j++)s.push(S[(k+p+j*3)%S.length]);out+=s.join(" ")+"\n\n";if(p==12)out+="* * *\n\n";}k++;}
require('fs').writeFileSync(__dirname + '/sample.md', out);
