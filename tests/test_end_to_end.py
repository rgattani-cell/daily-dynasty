"""Functional checks for shared league and authorization boundaries."""
import io
import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

os.environ['DD_DATA_DIR'] = tempfile.mkdtemp(prefix='daily-dynasty-test-')

from fastapi.testclient import TestClient
from PIL import Image
from app.main import app

HEADERS = {'X-Daily-Dynasty': '1'}
TODAY = datetime.now(ZoneInfo('America/New_York')).strftime('%Y-%m-%d')


def post(client, path, data):
    return client.post(path, json=data, headers=HEADERS)


def test_login_scores_shared_and_secure():
    with TestClient(app) as alice, TestClient(app) as bob:
        # Guest cannot see private league data.
        assert alice.get('/api/standings').status_code == 401
        assert post(alice, '/api/register', {'name':'Alice','password':'strong-pass-123'}).status_code == 200
        assert post(bob, '/api/register', {'name':'Bob','password':'another-pass-123'}).status_code == 200
        assert post(bob, '/api/register', {'name':'alice','password':'strong-pass-123'}).status_code == 409
        # Anti-CSRF header is mandatory on state-changing endpoints.
        assert alice.post('/api/scores',json={'game':'krillion','day':TODAY,'score':200}).status_code == 403
        assert post(alice, '/api/scores',{'game':'krillion','day':TODAY,'score':620}).status_code == 200
        assert post(bob, '/api/scores',{'game':'krillion','day':TODAY,'score':410}).status_code == 200
        assert post(alice, '/api/scores',{'game':'globle','day':TODAY,'score':3}).status_code == 200
        assert post(bob, '/api/scores',{'game':'globle','day':TODAY,'score':9}).status_code == 200
        scores=alice.get('/api/standings').json()['scores']
        assert len(scores)==4
        assert len(alice.get('/api/standings').json()['users'])==2
        # Can't tamper with somebody else's score (the server ignores user_id from clients).
        assert post(bob, '/api/scores',{'game':'krillion','day':TODAY,'score':450,'user_id':1}).status_code == 200
        krillion=alice.get('/api/standings').json()['scores']
        krillion=[s for s in krillion if s['game']=='krillion']
        assert sorted(s['score'] for s in krillion)==[450,620]
        # Validation: guesses positive whole, upper bounds, past and future dates.
        assert post(alice, '/api/scores',{'game':'globle','day':TODAY,'score':0}).status_code==400
        assert post(alice, '/api/scores',{'game':'globle','day':TODAY,'score':2.2}).status_code==400
        assert post(alice, '/api/scores',{'game':'plain','day':TODAY,'score':10001}).status_code==400
        assert post(alice, '/api/scores',{'game':'krillion','day':'2039-01-01','score':150}).status_code==400
        # Wonderhop optional 4x700 breakdown must exactly add up.
        good={'game':'wonderhop','day':TODAY,'score':2000,'breakdown':{'sky':600,'abyss':400,'past':500,'future':500}}
        assert post(alice,'/api/scores',good).status_code==200
        good['score']=1900
        assert post(alice,'/api/scores',good).status_code==400
        # Username edits protected and case-insensitive uniqueness enforced.
        assert alice.patch('/api/profile',json={'name':'Bob'},headers=HEADERS).status_code==409
        assert alice.patch('/api/profile',json={'name':'Ace'},headers=HEADERS).status_code==200
        assert alice.get('/api/me').json()['user']['name']=='Ace'
        # Log out ends just this user's session.
        assert post(alice,'/api/logout',{}).status_code==200
        assert alice.get('/api/standings').status_code==401
        assert post(alice,'/api/login',{'name':'ACE','password':'strong-pass-123'}).status_code==200
        assert alice.get('/api/standings').status_code==200
        assert post(alice,'/api/login',{'name':'ACE','password':'wrongwrong'}).status_code==401


def test_profile_photo():
    with TestClient(app) as client:
        assert post(client,'/api/register',{'name':'Photo User','password':'good-password'}).status_code==200
        img=Image.new('RGB',(300,300),(120,80,200));output=io.BytesIO();img.save(output,'PNG')
        res=client.post('/api/avatar',headers=HEADERS,files={'avatar':('avatar.png',output.getvalue(),'image/png')})
        assert res.status_code==200, res.text
        url=res.json()['avatar']
        assert url.startswith('/avatars/')
        assert client.get(url).status_code==200
        assert client.get('/api/me').json()['user']['avatar']==url
        bad=client.post('/api/avatar',headers=HEADERS,files={'avatar':('bad.png',b'this is not an image','image/png')})
        assert bad.status_code==400


def test_site_is_served():
    with TestClient(app) as client:
        assert client.get('/').status_code==200
        assert 'DAILY' in client.get('/').text
        assert client.get('/static/app.js').status_code==200
        assert client.get('/static/styles.css').status_code==200
