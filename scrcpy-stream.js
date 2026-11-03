'use strict';
const { spawn, execFile } = require('child_process');
const net = require('net');
const { promisify } = require('util');
const adbExec = promisify(execFile);
const AUD = Buffer.from([0,0,0,1,9,0xf0]);

// One instance per Android device. No command accesses other devices.
class ScrcpyStream {
  constructor({device, onFrame, onExit, serverJar='/usr/share/scrcpy/scrcpy-server', bitRate=2000000, maxFps=20}) {
    this.device=device; this.bitRate=bitRate; this.maxFps=maxFps; this.onFrame=onFrame; this.onExit=onExit; this.serverJar=serverJar;
    this.stopped=false; this.failed=false; this.blocked=false; this.inbuf=Buffer.alloc(0); this.jpg=Buffer.alloc(0); this.procs=[];
  }
  async adb(...args) { return adbExec('adb',['-s',this.device,...args],{timeout:10000,maxBuffer:1048576}); }
  async start() {
    try {
      await this.adb('push',this.serverJar,'/data/local/tmp/real-smart-phone-scrcpy.jar');
      if(this.stopped) return;
      const {stdout}=await this.adb('forward','tcp:0','localabstract:scrcpy');
      this.port=Number(stdout.trim()); if(!this.port) throw Error('invalid adb forward port');
      if(this.stopped){await this.cleanup();return;}
      this.encoder=spawn('adb',['-s',this.device,'shell','CLASSPATH=/data/local/tmp/real-smart-phone-scrcpy.jar','app_process','/','com.genymobile.scrcpy.Server','1.25','log_level=error','tunnel_forward=true','control=false','cleanup=false','send_device_meta=false','send_dummy_byte=false','send_frame_meta=true',`bit_rate=${this.bitRate}`,`max_fps=${this.maxFps}`],{stdio:'ignore'});
      this.procs.push(this.encoder); this.encoder.on('error',e=>this.fail(e));this.encoder.on('exit',()=>this.fail(Error('encoder exited')));
      this.decoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-flags','low_delay','-probesize','32','-analyzeduration','0','-f','h264','-i','pipe:0','-vsync','0','-vcodec','mjpeg','-threads','1','-flush_packets','1','-q:v','7','-f','image2pipe','pipe:1'],{stdio:['pipe','pipe','ignore']});
      this.procs.push(this.decoder);this.decoder.on('error',e=>this.fail(e));this.decoder.on('exit',()=>this.fail(Error('decoder exited')));this.decoder.stdin.on('error',e=>this.fail(e));
      this.decoder.stdout.on('data',b=>this.readJpeg(b));
      await new Promise(r=>setTimeout(r,700));
      await this.connect();
    } catch(e) {this.fail(e)}
  }
  async connect() {
    const start=Date.now();
    while(!this.stopped && Date.now()-start<5000) {
      let socket=net.createConnection({host:'127.0.0.1',port:this.port});
      const connected=await new Promise(resolve=>{socket.once('connect',()=>resolve(true));socket.once('error',()=>resolve(false));});
      if(this.stopped){socket.destroy();return;}
      if(!connected){socket.destroy();await new Promise(r=>setTimeout(r,100));continue;}
      this.socket=socket;
      socket.on('error',e=>this.fail(e));socket.on('close',()=>this.fail(Error('video socket closed')));
      socket.on('data',b=>this.readPackets(b));return;
    }
    if(!this.stopped) this.fail(Error('video connect timed out'));
  }
  readPackets(b) {
    this.inbuf=Buffer.concat([this.inbuf,b]);
    while(this.inbuf.length>=12) {
      const flags=this.inbuf.readBigUInt64BE(0),size=this.inbuf.readUInt32BE(8);
      if(size>8*1024*1024) return this.fail(Error('invalid video packet'));
      if(this.inbuf.length<12+size) break;
      const frame=this.inbuf.subarray(12,12+size);this.inbuf=this.inbuf.subarray(12+size);
      const data=(flags&(1n<<63n))?frame:Buffer.concat([frame,AUD]);
      if(!this.decoder.stdin.write(data)) {this.blocked=true;this.socket.pause();this.decoder.stdin.once('drain',()=>{if(this.socket&&!this.socket.destroyed){this.blocked=false;this.readPackets(Buffer.alloc(0));if(!this.blocked)this.socket.resume();}});break;}
    }
  }
  readJpeg(b) {
    this.jpg=Buffer.concat([this.jpg,b]);
    while(true) {
      let start=this.jpg.indexOf(Buffer.from([255,216]));
      if(start<0){this.jpg=this.jpg.subarray(Math.max(0,this.jpg.length-1));return;}
      let end=this.jpg.indexOf(Buffer.from([255,217]),start+2);
      if(end<0){this.jpg=this.jpg.subarray(start);if(this.jpg.length>8*1024*1024)this.fail(Error('invalid JPEG'));return;}
      const frame=Buffer.from(this.jpg.subarray(start,end+2));this.jpg=this.jpg.subarray(end+2);this.onFrame(frame);
    }
  }
  fail(err){if(this.failed||this.stopped)return;this.failed=true;this.stop().finally(()=>this.onExit(err));}
  async cleanup(){if(this.port){const p=this.port;this.port=null;try{await this.adb('forward','--remove',`tcp:${p}`)}catch{}}}
  async stop() {
    this.stopped=true;
    if(this.socket)this.socket.destroy();
    for(const p of this.procs){try{p.kill('SIGKILL')}catch{}}
    await this.cleanup();
  }
}
module.exports=ScrcpyStream;
