from flask import Flask, request, jsonify, render_template
import math

app = Flask(__name__)

requests_db = []
volunteers_db = []

def distance(loc1, loc2):
    return math.sqrt((loc1[0] - loc2[0])**2 + (loc1[1] - loc2[1])**2)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/request_help", methods=["POST"])
def request_help():
    data = request.json
    requests_db.append(data)

    # Try matching immediately
    nearest_volunteer = None
    min_dist = float("inf")

    for volunteer in volunteers_db:
        dist = distance(
            (data["lat"], data["lng"]),
            (volunteer["lat"], volunteer["lng"])
        )
        if dist < min_dist:
            min_dist = dist
            nearest_volunteer = volunteer

    if nearest_volunteer:
        return jsonify({
            "message": "Volunteer matched!",
            "volunteer": nearest_volunteer
        })

    return jsonify({"message": "No volunteers available yet."})

@app.route("/volunteer", methods=["POST"])
def volunteer():
    data = request.json
    volunteers_db.append(data)
    return jsonify({"message": "Volunteer registered successfully!"})

if __name__ == "__main__":
    app.run(debug=True)