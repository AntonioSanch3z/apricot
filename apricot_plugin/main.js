

define([
    'require',
    'jquery',
    'base/js/namespace',
    'base/js/events',
], function(
    requirejs,
    $,
    Jupyter,
    events,
    createRsaKeys
) {

    "use strict";
    
    //********************//
    //* Global variables *//
    //********************//
    
    var prefix = "infrastructure-deployment";
    
    var queues = ["slurm","OSCAR"];
    var commonapps = ["openports"];
    var applications = ["compilers","openmpi","nfs","sshkey","onedata","git"];
    var localApplications = ["compilers","openmpi","nfs","sshkey","onedata","openports","git"];

    var templatesURL = "";
    var localTemplatePrefix = "__local_";
    
    var deployInfo = {};

    var deploying = false; //Stores if the notebook is deploying something
    
    var clearDeployInfo = function(){
	var apps = [];
	if(typeof deployInfo.apps != undefined){
	    apps = deployInfo.apps;
	}
    var topology = ""
	if(typeof deployInfo.topology != undefined){
	    topology = deployInfo.topology;
    }    
    var queue = ""
	if(typeof deployInfo.queue != undefined){
	    queue = deployInfo.queue;
    }            
        deployInfo = {
	    "topology": topology,
         "user": "",
         "credential": "",
         "deploymentType": "OpenNebula",
	    "host": "",
        "networkID": "",
        "subnetID": "",
	    "tenant": "",
	    "id": "",
	    "infName": "cluster-name",
            "frontend":{
                "CPUs":1, //Minimum number of CPUs
		"instance": "",
                "memory": 2048, //in MB
                "flavour": "ubuntu",
                "version": "16.04",
                "image": "",
                "arch": "x86_64",
		"user": "ubuntu",
                "credentials": "ubuntu"
            },
            "worker":{
                "minNumber": 1, // Minimum number of workers
                "maxNumber": 1, // Minimum number of workers
                "CPUs":1, //Minimum number of CPUs
		"instance": "",
                "memory": 1024, //in MB
                "flavour": "ubuntu",
                "version": "16.04",
                "image": "",
                "arch": "x86_64",
		"user": "ubuntu",
                "credentials": "ubuntu",
            },
	    "destroyInterval": 3000,
      "apps": apps,
	    "queue": queue

        }
    }
    
    var load_css = function(){
        console.log("Loading css");
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = requirejs.toUrl("./main.css");
        document.getElementsByTagName("head")[0].appendChild(link);
    }
    
    var createTable = function(obj){
        var keyNames = Object.keys(obj);
        var nkeys = keyNames.length;

        var nElements = 0;
            
        var table = $('<table width="100%" border="5%">');
        
        var row = $("<tr>");
        //Iterate for all object properties and create
        //first row with its names.
        for(let i = 0; i < nkeys; i++){
            var name = keyNames[i];

            //Create column
            var column = $("<th>")
            .append(name)

            //Append column to row
            row.append(column);
            //Check if this property has more elements than previous ones
            if(nElements < obj[name].length){
                nElements = obj[name].length;
            }
        }
        //Apend row to table
        table.append(row);
        

        //Iterate for properties elements to create all element rows
        for(let j = 0; j < nElements; j++){

            var row = $("<tr>");
            for(let i = 0; i < nkeys; i++){
                var name = keyNames[i];

                //Create column
                var column = $("<th>")
                .append(obj[name][j])

                //Append column to row
                row.append(column);
            }
            //Append row to table
            table.append(row)
        }        
        return table;
    }
    
    //****************//
    //*   Buttons    *//
    //****************//
        
    var listDeployments_button = function(){
        console.log("Creating deployments list button");
        if(!Jupyter.toolbar){
            events.on("app_initialized.NotebookApp", listDeployments_button);
            return;
        }
        if($("#listDeployments_button").length === 0){
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help"   : "Deployments list",
                    "icon"   : "fa-list",
                    "handler": toggle_DeploymentList,
                }, "toggle-deployment-list", prefix)
            ]);
        }
    };

    var deploy_button = function(){
        console.log("Creating deploy button");
        if(!Jupyter.toolbar){
            events.on("app_initialized.NotebookApp", deploy_button);
            return;
        }
        clearDeployInfo();
        if($("#deploy_button").length === 0){
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help"   : "Infrastructure deploy",
                    "icon"   : "fal fa-sitemap",
                    "handler": toggle_Deploy,
                }, "toggle-deploy", prefix)
            ]);
        }
    };    
    
    //****************//
    //*   Dialogs    *//
    //****************//    
    
    var create_ListDeployments_dialog = function(show){

	//Check if kernel is available
	if(typeof Jupyter.notebook.kernel == "undefined" || Jupyter.notebook.kernel == null){
	    events.on("kernel_ready.Kernel", function(evt, data) {
		create_ListDeployments_dialog(show);
            });
	    return;
	}
        console.log("Creating deployments list window");
	
	// Get cluster list 

	var callbacks = {
	    iopub : {
		output : function(data){
		    //Check message
		    var check = checkStream(data)
		    if(check < 0) return; //Not a stream
		    if(check > 0){ //Error message
			alert(data.content.text);
			return;
		    }
		    
		    //Successfully execution
		    //console.log("Reviced:")
		    //console.log(data.content.text)

		    //Parse data
		    var words = data.content.text.split(" ");
		    var lists = {};
		    lists["Name"] = [];
		    lists["State"] = [];
		    lists["IP"] = [];
		    lists["Nodes"] = [];

		    for(let i = 5; i < words.length; i+=4){
			lists.Name.push(words[i]);
			lists.State.push(words[i+1]);
			lists.IP.push(words[i+2]);
			lists.Nodes.push(words[i+3]);
		    }
		    
		    var table = createTable(lists);

		    //Check if dialog has been already created
		    if($("#dialog-deployments-list").length == 0){
			var listDeployment_dialog = $('<div id="dialog-deployments-list" title="Deployments list">')
			    .append(table)
			$("body").append(listDeployment_dialog);
			$("#dialog-deployments-list").dialog();
		    } else{
			//Clear dialog
			$("#dialog-deployments-list").empty();

			//Append dable
			$("#dialog-deployments-list").append(table)
			$("#dialog-deployments-list").dialog("open");
		    }
		    if(show == false){
			$("#dialog-deployments-list").dialog("close");
		    }
		}
	    }
	};

	//Create listing script
	var cmd = "%%bash \n";
	cmd += "imOut=\"`python3 /usr/local/bin/im_client.py list`\"\n";
	//Print IM output on stderr or stdout
	cmd += "if [ $? -ne 0 ]; then \n";
	cmd += "    >&2 echo -e $imOut \n";	
	cmd += "    exit 1\n";
	cmd += "else\n";
	cmd += "    echo -e $imOut \n";	
	cmd += "fi\n";
	
	//console.log(cmd);
	//Deploy using IM
	var Kernel = Jupyter.notebook.kernel;
	Kernel.execute(cmd, callbacks);
    }
    
    
    var create_Deploy_dialog = function(){
        console.log("Creating deploy window");
        
        var deploy_dialog = $('<div id="dialog-deploy" title="Deploy infrastructure">')
        
        $("body").append(deploy_dialog);
        $("#dialog-deploy").dialog()
        
        //Set initial state
        state_Deploy_Mechanism();
        
        //Close dialog
        $("#dialog-deploy").dialog("close");
    }
    
    // Deploy button states
    var state_Deploy_Mechanism = function(){
        
        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Enable shortcuts
        Jupyter.keyboard_manager.enable();        

        //Clear dialog
        deployDialog.empty();
        
        deployDialog.append($("<p>Select deployment topology</p>"));
        
        deployDialog.dialog("option", "buttons",{
            "Advanced": function() {
		deployInfo.topology = "Advanced";
		deployInfo.queue = "";
		//Clear deploy apps selection
		deployInfo.apps = [];
		for(let i = 0; i < commonapps.length; i++){
			deployInfo.apps.push(commonapps[i])
		}
		state_deploy_provider();
	    },
            "MPI-Cluster": function() {
		deployInfo.topology = "MPI-Cluster";
		//Clear deploy apps selection
		deployInfo.queue = "slurm";
		deployInfo.apps = ["nfs","sshkey","compilers","openmpi","onedata","git"];
		for(let i = 0; i < commonapps.length; i++){
			deployInfo.apps.push(commonapps[i])
		}		    
		state_deploy_provider();
	    },
            "Batch-Cluster": function() {
		deployInfo.topology = "Batch-Cluster";
		//Clear deploy apps selection
		deployInfo.queue = "slurm";
		deployInfo.apps = ["nfs","sshkey","compilers","onedata","git"];
		for(let i = 0; i < commonapps.length; i++){
			deployInfo.apps.push(commonapps[i])
		}		    
		state_deploy_provider();
	    },
            "OSCAR": function() {
		deployInfo.topology = "OSCAR";
		deployInfo.queue = "OSCAR";
		//Clear deploy apps selection
		deployInfo.apps = [];
		for(let i = 0; i < commonapps.length; i++){
			deployInfo.apps.push(commonapps[i])
		}		
		//state_deploy_provider();
		console.log("on construction...");
	    }
    
        });
    }
    
    // select provider function
    var state_deploy_provider = function(){
     
        //Get dialog
        var deployDialog = $("#dialog-deploy");

	//Clear instance type
	deployInfo.frontend.instance = "";
	deployInfo.worker.instance = "";
	
        //Clear dialog
        deployDialog.empty();
        
        //Informative text
        deployDialog.append($("<p>Select infrastructure provider</p>"));
	
        deployDialog.dialog("option", "buttons",
	[
	   {
 	    text: "Back",
	    icon: "ui-icon-circle-arrow-w",
	    showText: false,
        click: state_Deploy_Mechanism
	   },   
       {
        text: "ONE",
        click: function() {

                //Check if the provider has been changed
                if(deployInfo.deploymentType != "OpenNebula"){
                    clearDeployInfo();
                }

                deployInfo.id = "one";
                deployInfo.deploymentType = "OpenNebula";

                state_deploy_credentials();
            }
       },
       {
           text: "EC2",
           click: function() {

                //Check if the provider has been changed
                if(deployInfo.deploymentType != "EC2"){
                    clearDeployInfo();
                }

                deployInfo.id = "ec2";
                deployInfo.deploymentType = "EC2";

                state_deploy_credentials();
            },
       },
       {
            text: "OST",
            click: function() {

                //Check if the provider has been changed
                if(deployInfo.deploymentType != "OpenStack"){
                    clearDeployInfo();
                }

                deployInfo.id = "ost";
                deployInfo.deploymentType = "OpenStack";

                state_deploy_credentials();
            }
       }
        ]);
    }

    // introduce credentials function
    var state_deploy_credentials = function(){
	
        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        

        //Create form for input
        var form = $("<form>")
        
        //Informative text
	var text1 = "";
	var text2 = "";
	var text3 = "";
	if(deployInfo.deploymentType == "EC2"){
	    text1 = "<p>Introduce AWS IAM credentials</p>";
	    text2 = "Access Key ID:<br>";
	    text3 = "Secret Access Key:<br>";
	}
	else if(deployInfo.deploymentType == "OpenNebula"){
	    text1 = "<p>Introduce ONE credentials</p>";
	    text2 = "Username:<br>";
	    text3 = "Password:<br>";

            //Create host input field
            form.append("Host:Port:<br>");
            form.append($('<input id="hostIn" type="text" value="' + deployInfo.host + '" name="host"><br>'));
	    
	}
	else if(deployInfo.deploymentType == "OpenStack"){
	    text1 = "<p>Introduce OST credentials</p>";
	    text2 = "Username:<br>";
	    text3 = "Password:<br>";

            //Create host input field
            form.append("host:<br>");
            form.append($('<input id="hostIn" type="text" value="' + deployInfo.host + '" name="host"><br>'));
	    	//Create tenant (project) input field
            form.append("tenant:<br>");
            form.append($('<input id="tenantIn" type="text" value="' + deployInfo.tenant + '" name="tenant"><br>'));	    	    
	}

        deployDialog.append($(text1));

        //Create username input field
        form.append(text2);
        form.append($('<input id="userIn" type="text" value="' + deployInfo.user + '" name="user"><br>'));

        //Create password input field
        form.append(text3);
        form.append($('<input id="userPassIn" type="password" value="' + deployInfo.credential + '" name="userPass"><br>'));

	deployDialog.append(form);
	
	deployDialog.dialog("option", "buttons",{
            "Back": state_deploy_provider,
	    "Next": function(){
		if(deployInfo.deploymentType == "OpenNebula"){
		    if(deployInfo.host != $("#hostIn").val()){
			deployInfo.frontend.image = ""
			deployInfo.worker.image = ""
			deployInfo.host = $("#hostIn").val();
		    }
		}
		deployInfo.user = $("#userIn").val();
		deployInfo.credential = $("#userPassIn").val();

		if(deployInfo.deploymentType == "EC2"){
		    state_deploy_EC2_instances();
		}
		else if(deployInfo.deploymentType == "OpenNebula"){
		    state_deploy_ONE_frontendSpec();
		}
		else if(deployInfo.deploymentType == "OpenStack"){
		    console.log("on construction...");
		    //deployInfo.tenant = $("#tenantIn").val();
		    //state_deploy_OST_frontendSpec();
		}
	    }
        });
    }

    // state deploy-EC2-instances
    var state_deploy_EC2_instances = function(){

        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        
        
        //Informative text
        deployDialog.append($("<p>Introduce required EC2 instance types:</p>"));
        
        //Create form for input
        var form = $("<form>")

	var zone = "us-east-1";
	var ami = "ami-0044130ca185d0880";
	if(deployInfo.frontend.image.length > 0){
	    var words = deployInfo.frontend.image.split('/');

	    if(words.length >= 4){
		zone = words[2];
		ami = words[3];
	    }
	}
	
        //Create availability zone input field
        form.append("Availability zone:<br>");
        form.append($('<input id="availabilityZoneIn" type="text" value="' + zone + '" name="availabilityZone"><br>'));	

	
	//Create AMI input field 
        form.append("AMI:<br>");
        form.append($('<input id="AMIIn" type="text" value="' + ami + '" name="AMI"><br>'));
	
        // //Create instance type input field for fronted
        // form.append("Frontend instance type:<br>");
        // form.append($('<input id="frontendInstanceTypeIn" type="text" value="' + deployInfo.frontend.instance + '" name="frontendInstanceType"><br>'));

        // //Create instance type input field for worker
        // form.append("Worker instance type:<br>");
        // form.append($('<input id="workerInstanceTypeIn" type="text" value="' + deployInfo.worker.instance + '" name="workerInstanceType"><br>'));

        // //Create VPC input field
        // form.append("VPC ID:<br>");
        // form.append($('<input id="networkIDIn" type="text" value="' + deployInfo.networkID + '" name="networkID"><br>'));	            
        
        // //Create subnet input field
        // form.append("VPC Subnet ID:<br>");
        // form.append($('<input id="subnetIDIn" type="text" value="' + deployInfo.subnetID + '" name="subnetID"><br>'));	            
        
        // //Create image username input field
        // form.append("Image username:<br>");
        // form.append($('<input id="imageUserIn" type="text" value="' + deployInfo.frontend.user + '" name="imageUser"><br>'));	    
	    
	//Append elements to dialog
	deployDialog.append(form);
	
	deployDialog.dialog("option", "buttons",{
            "Back": state_deploy_credentials,
	    "Next": function(){

		//Availability zone
		var AWSzone = $("#availabilityZoneIn").val();
		var AMI = $("#AMIIn").val();
		var imageURL = "aws://" + AWSzone + "/" + AMI;

        //deployInfo.networkID = $("#networkIDIn").val();
		//deployInfo.subnetID = $("#subnetIDIn").val();
		
		//Frontend
		//deployInfo.frontend.instance = $("#frontendInstanceTypeIn").val();
		deployInfo.frontend.image = imageURL;
		//deployInfo.frontend.user = $("#imageUserIn").val();

		//Worker
		//deployInfo.worker.instance = $("#workerInstanceTypeIn").val();
		deployInfo.worker.image = imageURL;
		//deployInfo.worker.user = $("#imageUserIn").val();
		
		state_deploy_app(state_deploy_EC2_instances);
	    }
        });
    }
    
    // state deploy ONE frontendSpec
    var state_deploy_ONE_frontendSpec = function(){
        
        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        
        
        //Informative text
        deployDialog.append($("<p>Introduce frontend specifications</p>"));
        
        //Create form for input
        var form = $("<form>")

        //Create CPU input field
        form.append("Minimum CPUs:<br>");
        form.append($('<input id="CPUsIn" type="number" value="' + deployInfo.frontend.CPUs + '" min="1" name="CPUs"><br>'));
	
        //Create memory input field
        form.append("Minimum memory (MB):<br>");
        form.append($('<input id="imageMemIn" type="number" value="' + deployInfo.frontend.memory + '" min="1024" name="imageMem"><br>'));
	
        //Create image url input field
        form.append("Image url:<br>");
	var imageURL = deployInfo.frontend.image;
	if(imageURL.length == 0){
	    if(deployInfo.deploymentType = "OpenNebula"){
		imageURL = "one://" + deployInfo.host + "/";
	    }
	}
        form.append($('<input id="imageUrlIn" type="text" value="' + imageURL + '" name="imageUrl"><br>'));

	deployDialog.append(form);

	deployDialog.dialog("option", "buttons",{
            "Back": state_deploy_credentials,
	    "Next": function(){
		deployInfo.frontend.CPUs = $("#CPUsIn").val();
		deployInfo.frontend.memory = $("#imageMemIn").val();
		deployInfo.frontend.image = $("#imageUrlIn").val();

		state_deploy_ONE_workerSpec();
	    }
        });
    }

    // state deploy OST frontendSpec
    var state_deploy_OST_frontendSpec = function(){

	//COMPLETAR!!!!
        
        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        
        
        //Informative text
        deployDialog.append($("<p>Introduce frontend specifications</p>"));
        
        //Create form for input
        var form = $("<form>")

        //Create CPU input field
        form.append("Minimum CPUs:<br>");
        form.append($('<input id="CPUsIn" type="number" value="' + deployInfo.frontend.CPUs + '" min="1" name="CPUs"><br>'));
	
        //Create memory input field
        form.append("Minimum memory (MB):<br>");
        form.append($('<input id="imageMemIn" type="number" value="' + deployInfo.frontend.memory + '" min="1024" name="imageMem"><br>'));
	
        //Create image url input field
        form.append("Image url:<br>");
	var imageURL = deployInfo.frontend.image;
	if(imageURL.length == 0){
	    if(deployInfo.deploymentType = "OpenStack"){
		imageURL = "one://" + deployInfo.host + "/";
	    }
	}
        form.append($('<input id="imageUrlIn" type="text" value="' + imageURL + '" name="imageUrl"><br>'));

	deployDialog.append(form);
	
	deployDialog.dialog("option", "buttons",{
            "Back": state_deploy_credentials,
	    "Next": function(){
		deployInfo.frontend.CPUs = $("#CPUsIn").val();
		deployInfo.frontend.memory = $("#imageMemIn").val();
		deployInfo.frontend.image = $("#imageUrlIn").val();

		if($("#imageUserIn").val().length == 0){
		    deployInfo.frontend.user = "";
		}else{
		    deployInfo.frontend.user = $("#imageUserIn").val();
		}
		
		if($("#imageUserPassIn").val().length == 0){
		    deployInfo.frontend.credentials = ""
		}else{
		    deployInfo.frontend.credentials = $("#imageUserPassIn").val();
		}
		
		
		state_deploy_ONE_workerSpec();
	    }
        });
    }
    
    // state deploy-one-worker
    var state_deploy_ONE_workerSpec = function(){
        
        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        
        
        //Informative text
        deployDialog.append($("<p>Introduce worker specifications</p>"));
        
        //Create form for input
        var form = $("<form>")

        //Create CPU input field
        form.append("Minimum CPUs:<br>");
        form.append($('<input id="CPUsIn" type="number" value="' + deployInfo.worker.CPUs + '" min="1" name="CPUs"><br>'));
	
        //Create memory input field
        form.append("Minimum memory (MB):<br>");
        form.append($('<input id="imageMemIn" type="number" value="' + deployInfo.worker.memory + '" min="1024" name="imageMem"><br>'));	
	
	deployDialog.append(form);
	
	deployDialog.dialog("option", "buttons",{
            "Back": state_deploy_ONE_frontendSpec,
	    "Next": function(){

		deployInfo.worker.image = deployInfo.frontend.image;
		deployInfo.worker.user = deployInfo.frontend.user;
		deployInfo.worker.credentials = deployInfo.frontend.credentials;		
		
		deployInfo.worker.memory = $("#imageMemIn").val();
		deployInfo.worker.CPUs = $("#CPUsIn").val();
		
		state_deploy_app(state_deploy_ONE_workerSpec);
	    }
        });
    }

    var state_deploy_app = function(back_function){

        //Get dialog
        var deployDialog = $("#dialog-deploy");
        
        //Clear dialog
        deployDialog.empty();
        
        //Disable shortcuts
        Jupyter.keyboard_manager.disable();        
	
        //Create form for input
        var form = $("<form>");

	//Create queue selector
	// var selector = $('<select id="queueSelector" name="queueSelector">');
	// for(let i = 0; i < queues.length; i++){
	//     let option = $('<option value="' + queues[i] + '">');
	//     option.text(queues[i]);
	//     selector.append(option);
	// }

	//Create cluster name input field
    form.append("Cluster name:<br>");
    form.append($('<input id="clusterNameIn" type="text" value="' + deployInfo.infName + '" name="clusterName"><br>'));

    if(deployInfo.topology != "OSCAR"){
        //Minimum workers input field
        form.append("Minimum workers:<br>");
        form.append($('<input id="clusterNWorkersIn" type="number" value="1" min="1" name="clusterNWorkers"><br>'));

		//Maximum workers input field
        form.append("Maximum workers:<br>");
        form.append($('<input id="clusterMaxWorkersIn" type="number" value="1" min="1" name="clusterMaxWorkers"><br>'));
	    
        //Create workers destroy time input field
        form.append("Workers idle time (s) before shutdown:<br>");
        form.append($('<input id="destroyTimeIn" type="number" value="' + deployInfo.destroyInterval + '" min="0" name="destroyTime"><br>'));
    }
	
	// if(deployInfo.topology == "Advanced"){
		
	//     //Queue selector
	//     form.append("Queue system:<br>");	
	//     form.append(selector);
		
	//     //Create check boxes with optional app
	//     var ul = $('<ul class="checkbox-grid">');
	//     for(let i = 0; i < applications.length; i++){

    //         if(applications[i] == "sshkey"){continue;} //sshkey will be used with nfs
    //         //Create line
    //         let line = $('<li style="white-space:nowrap">'); //Force checkbox and label to stay at same line
    //         //Create checkbox
    //         let checkbox = $('<input type="checkbox" id="' + applications[i] + '-appCheckID" name="' + applications[i] + '" value="' + applications[i] + '">');
    //         //Create label
    //         let label = $('<label for=" ' + applications[i] + '">');
    //         label.text(applications[i])	    
    
    //         //Append all to line
    //         line.append(checkbox);
    //         line.append(label);

    //         //Append line to grid
    //         ul.append(line);
	//     }
	// }
	
	//Append all to dialog
	deployDialog.append(form);

	// if(deployInfo.topology == "Advanced"){
    //         //Informative text
	//     deployDialog.append($("<br>"));
    //         deployDialog.append($("<p>Select cluster applications</p>"));
	//     deployDialog.append($("<br>"));
	    
	//     deployDialog.append(ul);
	// }
	
	deployDialog.dialog("option", "buttons",{
            "Back": function(){ back_function();},
	    "Deploy": function() {
		if(deploying){
		    alert("Previous deploy has been not finished.")
		    return; //Deploy only one infrastructure at once
		}
		deploying = true;
		
		//Get specified information
		deployInfo.infName = $("#clusterNameIn").val();
		deployInfo.worker.minNumber = $("#clusterNWorkersIn").val();
		deployInfo.worker.maxNumber = $("#clusterMaxWorkersIn").val();		    
		deployInfo.destroyInterval = $("#destroyTimeIn").val();

		// if(deployInfo.topology == "Advanced"){
		//     deployInfo.queue = $("#queueSelector").val();
		// }
		    
		if(deployInfo.worker.minNumber < 1){
		    deployInfo.worker.minNumber = 1
		}

		if(deployInfo.worker.maxNumber < deployInfo.worker.minNumber){
		    deployInfo.worker.maxNumber = deployInfo.worker.minNumber;
		}

		// //Set applications
		// for(let i = 0; i < applications.length; i++){
		//     if($("#" + applications[i] + "-appCheckID").length > 0){
		// 	if($("#" + applications[i] + "-appCheckID").is(":checked")){
		// 	    deployInfo.apps.push(applications[i]);
        //         if(applications[i] == "nfs"){
        //             //add "sshkey" too
        //             deployInfo.apps.push("sshkey");
        //         }
		// 	}
		//     }
		// }

		// //Print selected applications
		// console.log("Cluster applications: " + deployInfo.apps);

		//Create kernel callback
		var callbacks = {
		    iopub : {
			output : function(data){
			    //Check message
			    var check = checkStream(data)

			    if(check < 0){
				return; //Not a stream
			    }

			    var pubtext = data.content.text.replace("\r","\n");
			    if(check > 0){ //Error message
				deploying = false;
				alert(pubtext);
				console.log(pubtext)
				//Call self function to reconstruct dialog
				state_deploy_app(back_function);
				return;
			    }

			    //Successfully execution
			    deploying = false
			    console.log(pubtext)

			    //Call self function to reconstruct dialog
			    state_deploy_app(back_function);
			}
		    }
		};		

		//Create deploy script
		var cmd = deployIMCommand(deployInfo,templatesURL);
		//console.log(cmd)
		
		//Clear dialog
		deployDialog.empty();
		
		//Show loading spinner
		deployDialog.append($('<div class="loader"></div>'));
		
		//Remove buttons
		deployDialog.dialog("option", "buttons",{})
		
		//Deploy using IM
	  	var Kernel = Jupyter.notebook.kernel;
		Kernel.execute(cmd, callbacks);
	    }
	});
    }

    var deployIMCommand = function(obj, templateURL){

	var userReplace;
	if(obj.frontend.user.length > 0){
	    userReplace = obj.frontend.user;
	}
	else{
	    userReplace = "root";
	}
	
	var pipeAuth = obj.infName + "-auth-pipe";
	var imageRADL = obj.infName;
	var cmd = "%%bash \n";
	cmd += "PWD=`pwd` \n";
	//Remove pipes if exist
	cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
	//Create directory for templates
	cmd += "mkdir $PWD/templates &> /dev/null \n";

	//Create pipes
	cmd += "mkfifo $PWD/" + pipeAuth + "\n";
	//Write data to pipes/files
	cmd += "echo -e \"";

	cmd += "tosca_definitions_version: tosca_simple_yaml_1_0\n"

	if(obj.deploymentType == "OpenNebula"){
	    cmd += "description: Deploy on OpenNebula\n";
	} else if (obj.deploymentType == "EC2"){
	    cmd += "description: Deploy on EC2\n";
	}

	cmd += "topology_template:\n";
	cmd += "  node_templates:\n";

	//Frontend
	cmd += "    front:\n";
	cmd += "      type: tosca.nodes.indigo.Compute\n";
	cmd += "      capabilities:\n";
	

	

	    if(obj.frontend.image.length > 0){
            cmd += "        host:\n";
			cmd += "          properties:\n";
			cmd += "            num_cpus: " + obj.frontend.CPUs + "\n";
			cmd += "            mem_size: " + obj.frontend.memory + " MB \n";
	    }
		
		cmd += "        os:\n";
		cmd += "          properties:\n";
		cmd += "            type: linux\n";
		if(obj.deploymentType == "EC2"){
			cmd += "            image: '" + obj.frontend.image + "'\n";
		}
		else if(obj.deploymentType == "OpenNebula"){
			cmd += "            image: '" + obj.frontend.image + "'\n";
		}
	    cmd += "\n"
	

	//Workers
	cmd += "    wn:\n";
	cmd += "      type: tosca.nodes.indigo.Compute\n";
	cmd += "      capabilities:\n";

	    if(obj.worker.image.length > 0){
            cmd += "        host:\n";
			cmd += "          properties:\n";
			cmd += "            num_cpus: " + obj.worker.CPUs + "\n";
			cmd += "            mem_size: " + obj.worker.memory + " MB\n";
	    }

		cmd += "        os:\n";
		cmd += "          properties:\n";
		cmd += "            type: linux\n";
		if(obj.deploymentType == "EC2"){
			cmd += "            image: '" + obj.worker.image + "'\n";
		}
		else if(obj.deploymentType == "OpenNebula"){
			cmd += "            image: '" + obj.worker.image + "'\n";
		}

	    cmd += "\n"
		
	cmd += "\" > ~/.imclient/templates/" + imageRADL + ".yml\n";

	cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
			"id = " + obj.id + "; type = " + obj.deploymentType + "; host = " + obj.host + "; username = " + obj.user + "; password = " + obj.credential + ";\" > $PWD/" + pipeAuth + " & \n"
	//Create final command where the output is stored in "imOut"
	cmd += "imOut=\"`python3 /usr/local/bin/im_client.py -a $PWD/" + pipeAuth + " create " + "~/.imclient/templates/" + imageRADL + ".yml -r https://im.egi.eu/im" + " `\" \n";
	
	//Add applications
	// for(let i = 0; i < obj.apps.length; i++){
	//     //Check if is a local or a ec3 application
	//     if(localApplications.indexOf(obj.apps[i]) > -1){		
	// 	cmd += " __local_" + obj.apps[i];
	//     } else{
	// 	cmd += " " + obj.apps[i];
	//     }
	// }

	//Remove pipe
	cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
	//cmd += "rm -r $PWD/templates &> /dev/null \n";

	//Print im output on stderr or stdout
	cmd += "if [ $? -ne 0 ]; then \n";
	cmd += "    >&2 echo -e $imOut \n";	
	cmd += "    exit 1\n";
	cmd += "else\n";
	cmd += "    echo -e $imOut \n";	
	cmd += "fi\n";
	
	console.log("cmd2", cmd);
	return cmd;
    }

    var checkStream = function(data){
	if(data.msg_type == "stream"){
	    if(data.content.name == "stdout"){
		//Is a stdout message
		return 0;
	    }else{
		//Is a error message
		return 1;
	    }
	}
	//Is not a stream message
	return -1;
    }
    
    //****************//
    //*Dialogs handle*//
    //****************//    
    
    
    var toggle_DeploymentList = function(){
        if($("#dialog-deployments-list").dialog("isOpen")){
            $("#dialog-deployments-list").dialog("close");
        } else{
	    create_ListDeployments_dialog(true);
            $("#dialog-deployments-list").dialog("moveToTop");                        
        }
        Jupyter.notebook.set_dirty();
    }
    

    var toggle_Deploy = function(){
        if($("#dialog-deploy").dialog("isOpen")){
            $("#dialog-deploy").dialog("close");            
        } else{
            $("#dialog-deploy").dialog("open");                        
            $("#dialog-deploy").dialog("moveToTop");                        
        }
        Jupyter.notebook.set_dirty();
    }
    
    //*******************//
    //* Jupyter handler *//
    //*******************//        
    
    
    var load_jupyter_extension = function() {
        console.log("Initialize deployment plugin");
        load_css();
	
	//Get local yml directory
	var url = requirejs.toUrl("./templates");
	templatesURL = location.protocol + '//' + location.host
	    + url.substring(0, url.lastIndexOf('/'))
	    + "/templates";
	console.log("Templates url: " + templatesURL);
	
	listDeployments_button();
        deploy_button();
        create_ListDeployments_dialog(false);
        create_Deploy_dialog();
    }

    return {
        load_ipython_extension: load_jupyter_extension
    };
});
