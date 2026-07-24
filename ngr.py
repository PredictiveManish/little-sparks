from pyngrok import ngrok
import time

ngrok.set_auth_token("3Go7UF5fLKkBYh5XsAjimGWCSTh_2vkuGKYnmqAj1f3m3hDv6")

while True:
    try:
        print("Starting tunnel...")
        tunnel = ngrok.connect(8000)
        print("Public URL:", tunnel.public_url)
        
        # Keep the tunnel alive by sleeping in the connection thread
        ngrok.get_tunnels()  # keeps the process alive
        time.sleep(3600)  # check every hour
    except Exception as e:
        print(f"Tunnel disconnected: {e}")
        print("Reconnecting in 5 seconds...")
        time.sleep(5)