'use strict'

var mqtt = require('mqtt')
var fs = require('fs')
var path = require('path')
global.atob = require("atob");
var KEY = fs.readFileSync(path.join(__dirname, '/mqtt_test.private.key')) // Private Key
var CERT = fs.readFileSync(path.join(__dirname, '/mqtt_test.pem')) //  Certificate
var TRUSTED_CA_LIST = fs.readFileSync(path.join(__dirname, '/root.ca')) // Root CA

var PORT = 8883
var HOST = 'my.iot-ticket.com'
var reqIdNumber = 0
var minValue = 0
var maxValue = 10
var deviceId = "3EgKDoiUS08sxoJof7lnD6"
var topicBase = "v1/" + deviceId + "/"
var datanodeIDRandomNumber = "";
var datanodeIDcommand = "";

var options = {
  port: PORT,
  host: HOST,
  key: KEY,
  cert: CERT,
  rejectUnauthorized: true,
  // The CA list will be used to determine if server is authorized
  ca: TRUSTED_CA_LIST,
  protocol: 'mqtts'
}

var client = mqtt.connect(options)


// Functions that publish the message from a topic
function publish(requestJson, topic, needReqNumber = true){
	if(needReqNumber){
	    requestJson["reqId"] = "req" + reqIdNumber.toString()
	    reqIdNumber += 1
	}
	client.publish(topic, JSON.stringify(requestJson), function (err){
        if(err){
    	    console.log("Fail to publish", err)
	    }
    })
	
}

// Function generates a random number based on the configuration and publish the message
function send_random_number(){
	var min = Math.ceil(minValue);
    var max = Math.floor(maxValue);
    var myRandom = Math.floor(Math.random() * (max - min + 1)) + min;
	var date = new Date();
    var timestamp = date.getTime();
	var request = {}
	request[datanodeIDRandomNumber] = [{
		"v" : myRandom.toString(),
		"dt" : "DOUBLE",
		"ts" : timestamp.toString(),
		"s" : "100"
	}]
	publish(request, topicBase + 'evt/data/fmt/json', false)
	
}

// Function creates new datanodes
function create_datanode(name, path, unit, dataType, writable){
	var request = {
		"d" : [{
			"name" : name,
			"path" : path,
			"unit" : unit,
			"dataType" : dataType,
			"writable" : writable
		}]
	}
	publish(request, topicBase + 'evt/update/resource/datanodes')
}

// Function updates configuration (min and max value of the random number)
function update_config(config) {
	var dataJson = {}
    try {
        dataJson = JSON.parse(config);
    } catch (_error) {
		console.log("Config file is not a valid JSON")
	}
	if(dataJson.hasOwnProperty('maxValue') && dataJson.hasOwnProperty('minValue')){
		minValue = dataJson["minValue"]
		maxValue = dataJson["maxValue"]
	} else {
		console.log("Config is not valid")
	}
}

// Verifies if a configuration file exist in IoT-Ticket
function config_file_exist_test(){
	var request = {
		"fileTypes" : ["CONFIGURATION"]
	}
	publish(request, topicBase + "evt/request/resource/files/listing" )
}

// Function resquests a file by fileName and version.
function request_file(fileName, version){
	var request = {
		"fileName" : fileName,
		"version" : version,
		"maxChunkSize" : "100"
	}
	publish(request, topicBase + "evt/request/resource/files")
}

function log_light_value(value){
	if(value != null){
		if(value == "true"){
			console.log("Turn on the light!")
		} else {
			console.log("Turn off the light!")
		}
	}
}

// Function finds the datanode ID from a list of datanodes
function find_datanodID_from_answer(messageJson, datanodeName, datanodePath){
	for(var i = 0; i < messageJson["d"].length ; i++){
		if(messageJson["d"][i]["name"] == datanodeName && messageJson["d"][i]["path"] == datanodePath){
			return messageJson["d"][i]["mid"]
	    }
	}
	return ""
	
}

// Function finds the value of a datanode in a list of datanodes. It happens when the server sends a command.
function find_value_from_command(messageJson, datanodeID){
	for(var i = 0; i < messageJson["d"].length ; i++){
		if(messageJson["d"][i]["mid"] == datanodeID){
			return messageJson["d"][i]["value"]
		}
	}
	return null
}

// Function that receives the messages from the subscribed topics
client.on('message', function (topic, message) {
	message = message.toString()
	var messageJson = JSON.parse(message)
	if(topic == topicBase + 'evt/response/resource/datanodes'){ // Response to requests about datanodes
	    if(datanodeIDRandomNumber == ""){
	        datanodeIDRandomNumber = find_datanodID_from_answer(messageJson, "Random_Number", "JS/data")
		    if(datanodeIDRandomNumber == ""){
				create_datanode("Random_Number", "JS/data", "R" ,"DOUBLE", "true")
			}
		}
	    if(datanodeIDcommand == ""){
	        datanodeIDcommand = find_datanodID_from_answer(messageJson, "Light", "home/kitchen")
		    if(datanodeIDcommand == ""){
				create_datanode("Light", "home/kitchen", "n/a" ,"BOOLEAN", "true")
			}
		}
		
    } else if (topic == topicBase + "evt/response/resource/files/listing"){ // Response to file list request
		if(messageJson["d"].length != 0){
		    request_file(messageJson["d"][0]["fileName"], messageJson["d"][0]["version"])
		}
	} else if (topic == topicBase + "evt/response/resource/files"){ // Response to a requested file
		update_config(atob(messageJson["file"]))
	} else if (topic == topicBase + "evt/updated/resource/files"){ // IoT-Ticket platform warn that a file was updated
	    if(messageJson["fileType"] == "CONFIGURATION"){
			request_file(messageJson["fileName"], messageJson["version"])
		}
	} else if (topic == topicBase + "cmd/control"){
		var value = find_value_from_command(messageJson, datanodeIDcommand)
		log_light_value(value)
	    var response = {
			"rc" : "200",
			"message" : "OK",
			"reqId" : messageJson["reqId"]
		}
		publish(response, topicBase + "cmd/response", false)
	}
})

// Action to be done after connected to the broker
client.on('connect', function () {
    console.log('Connected')
    client.subscribe(topicBase + "evt/response/resource/datanodes")
    client.subscribe(topicBase + "evt/response/resource/files/listing")
    client.subscribe(topicBase + "evt/response/resource/files")
    client.subscribe(topicBase + "evt/updated/resource/files")
	client.subscribe(topicBase + "cmd/control")
    config_file_exist_test()
    var emptyrequest = {}
    publish(emptyrequest, topicBase + "evt/request/resource/datanodes")
    setInterval(send_random_number, 2000);
})


