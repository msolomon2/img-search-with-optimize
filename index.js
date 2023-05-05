const fs = require("fs");
const http = require("http");
const https = require("https");

const url = require("url");
const querystring = require("querystring");
const {client_id, client_secret} = require("./auth/credentials.json");

const port = 3000;
const server = http.createServer();
server.on("request", request_handler);
server.on("listening", listen_handler);
server.listen(port);

let globalword = "";


function listen_handler(){
    console.log(`Now Listening on Port ${port}`);
}
//Handle requests to specific urls
function request_handler(req, res){
    console.log(req.url);
    //Root of the website
    if (req.url === "/"){
        const form = fs.createReadStream("html/index.html");
        res.writeHead(200, {"Content-Type": "text/html"})
        form.pipe(res);
    }
    //Authorization from Imgur
    else if (req.url.startsWith("/imgur_auth1")){
        fs.createReadStream("redirect.html").pipe(res);
    }
    else if (req.url.startsWith("/imgur_auth2")){
        //Split up the url into several parts
        let auth_info = new URL(req.url, `https://${req.headers.host}`).searchParams;
        console.log(auth_info);

        //Get the refresh token (this is what imgur seems to want for getting a proper access token)
        let myrefresh = auth_info.get('refresh_token');
        console.log(myrefresh);
        console.log(globalword);
        tokentime(myrefresh,globalword,res);
        
    }
    //Search query for imgur search
    else if (req.url.startsWith("/search"))
    {
        const user_input = new URL(req.url, `https://${req.headers.host}`).searchParams;
        console.log(user_input);
        globalword = user_input.get('word');
        if(globalword == null || globalword == ""){
            not_found(res);       
        }
        else{
            redirect_to_imgur(globalword,res);
        }
    }
    else
    {
        not_found(res);
    }
}

function redirect_to_imgur(word,res){
    //Send an authorization request to imgur to get an authorization token using the client id
    //response_type only has one valid parameter so it's hardcoded
    //Only a client ID is necessary for this part
    const authorization_endpoint = `https://api.imgur.com/oauth2/authorize`;
    //let uri = JSON.stringify(client_id);
    console.log(`${authorization_endpoint}?client_id=${client_id}&response_type=token`);
    res.writeHead(302,{Location: `${authorization_endpoint}?client_id=${client_id}&response_type=token&state=${word}`}).end();
}


function not_found(res){
	res.writeHead(404, {"Content-Type": "text/html"});
	res.end(`<h1>404 Not Found</h1>`);
}

function process_stream (stream, callback, ...args){
    let body = "";
    stream.on("data", chunk => body += chunk);
    stream.on("end", () => callback(body, ...args));
}
//Get a new access token
function tokentime(refresh,word,res){
    let post_data = querystring.stringify(refresh,client_id,client_secret,'refresh_token');
    console.log(post_data);
	let options = {
		method: "POST",
		headers:{
			"Content-Type":"application/x-www-form-urlencoded"
		}
	}
    https.request(
		"https://api.imgur.com/oauth2/token", 
		options, 
		(token_stream) => process_stream(token_stream, receive_access_token, word, res)
	).end(post_data);
}

function receive_access_token(body, word, res){
	const {access_token} = JSON.parse(body);
	imgur_request_image(word, access_token, res);
}
//Request an image using an imgur api search call
function imgur_request_image(word, access_token, res){
	const imgur_search_endpoint = `https://api.imgur.com/3/gallery/search/?q=${word}`;
    console.log(imgur_search_endpoint);
	const options = {
		headers: {
			Authorization: `Client-ID ${client_id}`
		}
	}
    console.log(options);
	https.request(
		imgur_search_endpoint, 
		options, 
		(search_stream) => process_stream(search_stream, receive_search_results, res)
	).end();
}


//Search results from imgur
function receive_search_results(body, res){
	const results = JSON.parse(body);
    console.log(results);
    const myimgurlink = results.data[0].images[0].link;
	console.log(myimgurlink);

    optimize(myimgurlink,res);
}

//Optimize the image using the resmush API
function optimize(link,res){
    const optimize_endpoint = `http://api.resmush.it/ws.php?img=${link}`;
    http.request(optimize_endpoint,null,(optistream) => process_stream(optistream,imgur_post,link,res)).end();
}

//Post the (optimized) image to imgur
function imgur_post(body,link,res){
    const optiresults = JSON.parse(body);
    console.log(optiresults);
    const myimage_opt = optiresults.dest;
    console.log(myimage_opt);

    const myorigsize = optiresults.src_size;
    const myoptisize = optiresults.dest_size;

    console.log("Original size: " + myorigsize);
    
    console.log("Optimized size: " + myoptisize);
    //Set the image type, title, description, and link to the optimized image
    let mydata = {image:link,type:'url',title:'Optimized image keyword: ' + globalword,description:'Original size: ' + myorigsize + ', Optimized size: ' + myoptisize};
    let opti_data = querystring.stringify(mydata);
    let options = {
		method: "POST",
		headers:{
            Authorization: `Client-ID ${client_id}`,
			"Content-Type":"application/x-www-form-urlencoded"
		}
	}
    https.request(
		"https://api.imgur.com/3/upload", 
		options, 
		(final_stream) => process_stream(final_stream, final_redirect, res)
	).end(opti_data);
}

//Send a redirect to the final optimized image uploaded on imgur
function final_redirect(body,res)
{
    const final_results = JSON.parse(body);
    let myfinallink = final_results.data.link;
    res.writeHead(302, {Location: `${myfinallink}`})
    .end();
}