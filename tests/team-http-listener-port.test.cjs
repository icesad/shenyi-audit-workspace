'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {listenOnLoopback}=require('../server/team/team-http-listener.mjs');

test('ephemeral loopback listener retries OS-reserved Windows ports',async()=>{
  class FakeServer extends EventEmitter {
    attempts=0;
    bound=null;
    listen(options){
      this.attempts++;
      queueMicrotask(()=>{
        if(this.attempts===1){const error=Object.assign(new Error('reserved ephemeral port'),{code:'EACCES'});this.emit('error',error);return;}
        this.bound={address:options.host,family:'IPv4',port:45678};
        this.emit('listening');
      });
    }
    address(){return this.bound;}
    close(callback){this.bound=null;callback?.();}
    closeAllConnections(){}
  }
  const server=new FakeServer();
  const bound=await listenOnLoopback(server,0);
  assert.equal(server.attempts,2);
  assert.equal(bound.port,45678);
  assert.equal(bound.address,'127.0.0.1');
});
