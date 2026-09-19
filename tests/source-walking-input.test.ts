import {it,expect} from 'vitest';
import {EMPTY_INPUT,validateInput} from '../game/types';
it('accepts optional IN_SPEED request but never client-owned walking or recoil state',()=>{
 const base={...EMPTY_INPUT,seq:1};
 expect(validateInput({...base,walk:true,sourceWalking:false,sourceRifleHandling:{bad:true}})).toEqual({...base,walk:true});
 expect(validateInput({...base,walk:undefined})).toEqual({...base,walk:false});
 for(const value of [1,'true',null,[],{}])expect(validateInput({...base,walk:value})).toBeNull();
});
