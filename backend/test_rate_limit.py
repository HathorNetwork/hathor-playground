#!/usr/bin/env python3
"""
Simple test script for rate limiting functionality
"""
import asyncio
import aiohttp
import time
import json
from typing import List, Dict

async def test_rate_limiting():
    """Test rate limiting with multiple concurrent requests"""
    
    base_url = "http://localhost:8000"
    
    # Test payload
    test_payload = {
        "message": "Hello, can you help me with a simple nano contract?",
        "current_file_content": "# Simple test file\nprint('hello')",
        "current_file_name": "test.py",
        "console_messages": ["INFO: Test message"],
        "execution_logs": "Test execution log",
        "context": {"test": True}
    }
    
    async def make_request(session: aiohttp.ClientSession, request_id: int) -> Dict:
        """Make a single request and return result"""
        try:
            start_time = time.time()
            async with session.post(
                f"{base_url}/api/ai/chat",
                json=test_payload,
                headers={"Content-Type": "application/json"}
            ) as response:
                end_time = time.time()
                
                # Get rate limit headers
                headers = dict(response.headers)
                rate_limit_headers = {
                    k: v for k, v in headers.items() 
                    if k.startswith("X-RateLimit") or k == "Retry-After"
                }
                
                result = {
                    "request_id": request_id,
                    "status": response.status,
                    "time": end_time - start_time,
                    "rate_headers": rate_limit_headers
                }
                
                if response.status == 200:
                    result["response"] = await response.json()
                elif response.status == 429:
                    result["error"] = await response.text()
                
                return result
                
        except Exception as e:
            return {
                "request_id": request_id,
                "status": "error",
                "error": str(e),
                "time": 0
            }
    
    print("🧪 Testing Rate Limiting...")
    print("=" * 50)
    
    # Test 1: Check if server is running
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{base_url}/health") as response:
                if response.status == 200:
                    print("✅ Server is running")
                else:
                    print(f"❌ Server health check failed: {response.status}")
                    return
    except Exception as e:
        print(f"❌ Cannot connect to server: {e}")
        print("Please make sure the backend server is running on localhost:8000")
        return
    
    # Test 2: Single request to check normal operation
    print("\n📝 Test 1: Single request")
    async with aiohttp.ClientSession() as session:
        result = await make_request(session, 1)
        print(f"Status: {result['status']}")
        print(f"Time: {result['time']:.2f}s")
        if result.get('rate_headers'):
            print("Rate limit headers:")
            for header, value in result['rate_headers'].items():
                print(f"  {header}: {value}")
    
    # Test 3: Burst of requests to trigger rate limiting
    print("\n🚀 Test 2: Burst of 10 requests to test rate limiting")
    
    async with aiohttp.ClientSession() as session:
        tasks = [make_request(session, i) for i in range(1, 11)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        successful = 0
        rate_limited = 0
        errors = 0
        
        for result in results:
            if isinstance(result, Exception):
                errors += 1
                print(f"❌ Request failed: {result}")
                continue
                
            if result['status'] == 200:
                successful += 1
                print(f"✅ Request {result['request_id']}: SUCCESS ({result['time']:.2f}s)")
            elif result['status'] == 429:
                rate_limited += 1
                print(f"🚫 Request {result['request_id']}: RATE LIMITED")
            else:
                errors += 1
                print(f"❌ Request {result['request_id']}: ERROR {result['status']}")
        
        print(f"\n📊 Results:")
        print(f"  Successful: {successful}/10")
        print(f"  Rate Limited: {rate_limited}/10")
        print(f"  Errors: {errors}/10")
        
        if rate_limited > 0:
            print("✅ Rate limiting is working!")
        else:
            print("⚠️  No rate limiting detected - check configuration")
    
    # Test 4: Check provider switching (if configured)
    print("\n🔄 Test 3: Provider configuration check")
    try:
        import os
        provider = os.getenv("AI_PROVIDER", "openai")
        print(f"Current AI provider: {provider}")
        
        if provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            print(f"OpenAI API key configured: {'Yes' if api_key else 'No'}")
        elif provider == "gemini":
            api_key = os.getenv("GOOGLE_API_KEY") 
            print(f"Google API key configured: {'Yes' if api_key else 'No'}")
        
    except Exception as e:
        print(f"Could not check provider config: {e}")
    
    print("\n🎉 Rate limiting test completed!")

if __name__ == "__main__":
    asyncio.run(test_rate_limiting())