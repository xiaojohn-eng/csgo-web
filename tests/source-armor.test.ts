import fs from 'node:fs';
import {expect,it} from 'vitest';
import {sourceArmorPurchase} from '../game/source-armor';

const original=fs.existsSync('output/tests/source-armor-price-native.json')?it:it.skip;
original('matches all 16 original item quotes and independently executed ownership branches',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-armor-price-native.json','utf8'));
  expect(oracle.status).toBe('PASS');
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(oracle.rows).toHaveLength(16);
  for(const row of oracle.rows){
    expect(typeof row.originalOwnershipAllowed).toBe('boolean');
    const item=row.itemId===50?'armor':'helmet';
    const result=sourceArmorPurchase(item,row.armor,row.helmet);
    if(!row.originalOwnershipAllowed)expect(result).toBeNull();
    else expect(result).toEqual({cost:row.originalQuotedPrice,armor:100,helmet:item==='helmet'||row.helmet});
  }
});
it('refills damaged body armor without removing a helmet and only discounts a helmet at full armor',()=>{
  expect(sourceArmorPurchase('armor',1,true)).toEqual({cost:650,armor:100,helmet:true});
  expect(sourceArmorPurchase('helmet',99,false)).toEqual({cost:1000,armor:100,helmet:true});
  expect(sourceArmorPurchase('helmet',100,false)).toEqual({cost:350,armor:100,helmet:true});
  expect(sourceArmorPurchase('helmet',1,true)).toBeNull();
  expect(sourceArmorPurchase('armor',100,false)).toBeNull();
});
it('rejects values outside the ordinary armor contract before quoting a transaction',()=>{
  for(const armor of [-1,.5,101,NaN,Infinity])expect(()=>sourceArmorPurchase('armor',armor,false)).toThrow();
  expect(()=>sourceArmorPurchase('kit' as 'armor',0,false)).toThrow();
  expect(()=>sourceArmorPurchase('armor',0,1 as unknown as boolean)).toThrow();
});
