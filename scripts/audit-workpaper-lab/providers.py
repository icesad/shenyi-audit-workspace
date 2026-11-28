"""Model adapters. API keys stay in the calling process."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


ENDPOINTS = {
    'openai': ('https://api.openai.com/v1', 'OPENAI_API_KEY'),
    'compatible': ('', 'LLM_API_KEY'),
    'anthropic': ('https://api.anthropic.com/v1', 'ANTHROPIC_API_KEY'),
    'gemini': ('https://generativelanguage.googleapis.com/v1beta', 'GEMINI_API_KEY'),
}


def prepare_request(profile, system, prompt, key):
    provider = profile['provider']
    default, _ = ENDPOINTS[provider]
    base = profile.get('base_url', default).rstrip('/')
    host = urlsplit(base)
    local = host.hostname in {'127.0.0.1', 'localhost', '::1'}
    if (not host.hostname or host.username or host.password or host.query or host.fragment
            or not (host.scheme == 'https' or (local and host.scheme == 'http'))):
        raise ValueError('API base_url 须为 HTTPS 或本机 HTTP，URL 不含密钥、查询项或账号。')
    if not key and not local:
        raise ValueError('未设置此模型的 API Key 环境变量。')
    model = profile['model']
    limit = int(profile.get('max_tokens', 6000))
    if not 32 <= limit <= 32768:
        raise ValueError('max_tokens 须在32–32768之间。')
    headers = {'Content-Type': 'application/json'}
    if provider == 'anthropic':
        headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
        body = {'model': model, 'system': system, 'max_tokens': limit, 'messages': [{'role': 'user', 'content': prompt}]}
        return Request(base + '/messages', json.dumps(body).encode(), headers)
    if provider == 'gemini':
        headers['x-goog-api-key'] = key
        body = {'systemInstruction': {'parts': [{'text': system}]}, 'contents': [{'parts': [{'text': prompt}]}],
                'generationConfig': {'responseMimeType': 'application/json', 'maxOutputTokens': limit}}
        return Request(f'{base}/models/{quote(model.removeprefix("models/"), safe="")}:generateContent', json.dumps(body).encode(), headers)
    if key:
        headers['Authorization'] = f'Bearer {key}'
    token_field = 'max_completion_tokens' if provider == 'openai' else 'max_tokens'
    body = {'model': model, token_field: limit, 'messages': [{'role': 'system', 'content': system},
                                                           {'role': 'user', 'content': prompt}]}
    return Request(base + '/chat/completions', json.dumps(body).encode(), headers)


def read_text(provider, payload):
    if provider == 'anthropic':
        if payload.get('stop_reason') == 'max_tokens':
            raise ValueError('模型达到输出长度限制。')
        return ''.join(block['text'] for block in payload['content'] if block['type'] == 'text')
    if provider == 'gemini':
        candidate = payload['candidates'][0]
        if candidate.get('finishReason') == 'MAX_TOKENS':
            raise ValueError('模型达到输出长度限制。')
        return ''.join(part.get('text', '') for part in candidate['content']['parts'] if not part.get('thought'))
    choice = payload['choices'][0]
    if choice.get('finish_reason') == 'length':
        raise ValueError('模型达到输出长度限制。')
    return choice['message']['content'] or ''


def complete(profile, system, prompt):
    provider = profile['provider']
    _, env = ENDPOINTS[provider]
    request = prepare_request(profile, system, prompt, os.getenv(profile.get('key_env', env), ''))
    try:
        with build_opener(NoRedirect()).open(request, timeout=120) as response:
            data = response.read(4_000_001)
    except HTTPError as error:
        raise ValueError(f'模型 API 返回 HTTP {error.code}。') from None
    except (URLError, TimeoutError):
        raise ValueError('模型 API 连接失败或超时。') from None
    if len(data) > 4_000_000:
        raise ValueError('模型响应过大。')
    try:
        content = read_text(provider, json.loads(data))
        if not isinstance(content, str):
            raise TypeError
        return content
    except (KeyError, TypeError, IndexError, json.JSONDecodeError):
        raise ValueError('模型 API 返回的响应结构与所选接口不符。') from None
