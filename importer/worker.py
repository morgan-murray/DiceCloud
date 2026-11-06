#!/usr/bin/env python3
"""One bounded stdin/stdout request. No network, shell or user-selected paths."""
import json
import os
from pathlib import Path
import resource
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from aurora.character import extract
from aurora.content import CompendiumQuery
from aurora.secure import canonical, fail, ImportErrorDetail

MAX_INPUT=14*1024**2

def handle(request):
    if not isinstance(request,dict) or request.get('schemaVersion')!=1:fail('INVALID_REQUEST','request','Unsupported request version.')
    operation=request.get('operation')
    if operation=='pack' and set(request)<= {'schemaVersion','operation','files'}:
        return CompendiumQuery(request.get('files',[])).result()
    if operation=='character' and set(request)<= {'schemaVersion','operation','files','character'}:
        return extract(request.get('character'),request.get('files',[]))
    fail('INVALID_REQUEST','request','Unsupported operation or fields.')

def main():
    resource.setrlimit(resource.RLIMIT_CPU,(8,8))
    # macOS does not implement a usable RLIMIT_AS; production is Linux.
    if sys.platform.startswith('linux'):resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE,(32,32))
    resource.setrlimit(resource.RLIMIT_FSIZE,(0,0))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    try:
        raw=sys.stdin.buffer.read(MAX_INPUT+1)
        if len(raw)>MAX_INPUT:fail('SIZE_LIMIT','request','Request exceeds its input limit.')
        try:request=json.loads(raw)
        except (ValueError,UnicodeDecodeError,RecursionError):fail('INVALID_REQUEST','request','Expected bounded UTF-8 JSON.')
        response=dict(ok=True,result=handle(request))
    except ImportErrorDetail as error:response=dict(ok=False,diagnostics=[error.diagnostic])
    except Exception:response=dict(ok=False,diagnostics=[dict(severity='error',code='WORKER_ERROR',field='request',message='The importer could not safely interpret this file.')])
    output=canonical(response)
    if len(output)>2*1024**2:output=canonical(dict(ok=False,diagnostics=[dict(severity='error',code='OUTPUT_LIMIT',field='request',message='Import result exceeds its size limit.')]))
    sys.stdout.buffer.write(output+b'\n')

if __name__=='__main__':main()
