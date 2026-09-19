"""Original normal armor prices and the current-build helmet upgrade branch.

Runs the original item-ID/armor/helmet comparisons and subtraction. The item
schema lookups between these blocks are supplied from the hash-checked original
items_game.txt; this is a pricing oracle, not a live purchase or funds transfer.
"""
from pathlib import Path
import hashlib,json,re,importlib.util

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_damage_oracle',ROOT/'scripts/probe-source-damage.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
source=ROOT/'.reference-assets/csgo-legacy/csgo/scripts/items/items_game.txt';raw=source.read_bytes()
assert hashlib.sha256(raw).hexdigest()=='510e09b68a01d88edba2342972960025fd6484aaaa58365fcf47d8513de79623'
text=raw.decode();items={}
for ident,name in [(50,'item_kevlar'),(51,'item_assaultsuit')]:
    pattern=rf'\n\t\t"{ident}"\s*\{{(.*?)\n\t\t\}}'
    match=re.search(pattern,text,re.S);assert match
    body=match[1];assert re.search(rf'"name"\s*"{name}"',body)
    price=int(re.search(r'"in game price"\s*"(\d+)"',body)[1])
    items[ident]=dict(name=name,price=price,startLine=text.count('\n',0,match.start())+2)
assert items[50]['price']==650 and items[51]['price']==1000
engine=module.OriginalDamage();rows=[]
for ident in (50,51):
    for armor in (0,1,99,100):
        for helmet in (False,True):
            engine.reset();u=engine.u
            u.reg_write(module.UC_X86_REG_ESI,ident);u.reg_write(module.UC_X86_REG_EAX,51)
            u.reg_write(module.UC_X86_REG_EBX,items[ident]['price'])
            engine.ints(module.F+8,[module.P]);engine.ints(module.P+0xfb8,[armor])
            u.mem_write(module.P+0x174c,bytes([int(helmet),0]))
            end=engine.run(0xc7129a,[0xc7129f,0xc71338])
            discount=end==0xc71338
            if discount:
                # The intervening original lookups resolve item_kevlar, proved
                # by 0xc713f8 writing its raw string to the lookup descriptor.
                assert engine.raw[0xc713f8:0xc71402].hex()=='c705acc286015ca52b01'
                assert engine.raw[0x12ba55c:0x12ba55c+12]==b'item_kevlar\0'
                u.reg_write(module.UC_X86_REG_EAX,module.W)
                engine.ints(module.W+0xd0,[items[50]['price']])
                engine.run(0xc71393,[0xc71399])
            quote=u.reg_read(module.UC_X86_REG_EBX)
            expected=350 if ident==51 and armor==100 and not helmet else items[ident]['price']
            assert quote==expected
            # Execute the actual purchase-entry ownership branch separately
            # from pricing, before messages, entity creation or money changes.
            u.reg_write(module.UC_X86_REG_EBX,module.P)
            if ident==50:
                ownership_exit=engine.run(0xc47e8c,[0xc47ec0,0xc47e97])
                ownership_allowed=ownership_exit==0xc47ec0
            else:
                ownership_exit=engine.run(0xc4812a,[0xc48260,0xc48144,0xc482b0])
                ownership_allowed=ownership_exit!=0xc48260
            rows.append(dict(itemId=ident,item=items[ident]['name'],armor=armor,helmet=helmet,originalQuotedPrice=quote,
                             originalDiscountBranch=discount,originalOwnershipAllowed=ownership_allowed,
                             ownershipExit=hex(ownership_exit)))
report=dict(status='PASS',sourceServerSha256=module.SHA,sourceItemsSha256=hashlib.sha256(raw).hexdigest(),items=items,
    priceFunction='0xc711d0',eligibilityBlock=['0xc7129a','0xc71338'],originalPriceSubtraction=['0xc71393','0xc71399'],rows=rows,
    purchaseFunctions={'kevlar':'0xc47e20','assaultsuit':'0xc48080'},
    ownershipBlocks={'kevlar':['0xc47e8c','0xc47ec0','0xc47e97'],
                     'assaultsuit':['0xc4812a','0xc48260','0xc48144','0xc482b0']},
    limits=['Original price arithmetic and eligibility are executed; actual schema lookup values are injected from the original hash-checked item definitions.',
            'Buying still requires normal alive/buy-zone/buy-time/money eligibility, which this price oracle does not simulate.',
            'Direct item_assaultsuit purchase rejects an already-owned helmet; damaged body armor can be replenished via item_kevlar instead.'])
(ROOT/'output/tests/source-armor-price-native.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
