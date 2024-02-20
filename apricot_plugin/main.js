define([
    'require',
    'jquery',
    'base/js/namespace',
    'base/js/events',
], function (
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

    var commonapps = ["openports"];
    var applications = [];
    var localApplications = ["compilers", "openmpi", "nfs", "sshkey", "onedata", "openports", "git"];

    var templatesURL = "";
    var localTemplatePrefix = "__local_";

    var deployInfo = {};

    var deploying = false; //Stores if the notebook is deploying something

    var clearDeployInfo = function () {
        var apps = [];
        if (typeof deployInfo.apps != undefined) {
            apps = deployInfo.apps;
        }
        var topology = ""
        if (typeof deployInfo.topology != undefined) {
            topology = deployInfo.topology;
        }
        var recipe = ""
        if (typeof deployInfo.recipe != undefined) {
            recipe = deployInfo.recipe;
        }

        deployInfo = {
            "topology": topology,
            "recipe": recipe,
            "user": "",
            "credential": "",
            "deploymentType": "OpenNebula",
            "host": "",
            "networkID": "",
            "subnetID": "",
            "tenant": "",
            "id": "",
            "infName": "cluster-name",
            "frontend": {
                "CPUs": 1, // Number of CPUs
                "memory": 4,
                "disk": 10,
                "instance": "",
                "memory": 2, //in GB
                "image": "",
                "user": "ubuntu",
                "credentials": "ubuntu"
            },
            "worker": {
                "instances": 1, // Number of VMs
                "CPUs": 1, // Number of CPUs
                "instance": "",
                "memory": 2, //in GB
                "flavour": "ubuntu",
                "disk": 20,
                "GPUs": 1,
                "image": "",
                "user": "ubuntu",
                "credentials": "ubuntu",
            },
            "apps": apps,
        }
    }

    var load_css = function () {
        console.log("Loading css");
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = requirejs.toUrl("./main.css");
        document.getElementsByTagName("head")[0].appendChild(link);
    }

    var createTable = function (obj) {
        var keyNames = Object.keys(obj);
        var nkeys = keyNames.length;

        var nElements = 0;

        var table = $('<table width="100%" border="5%">');

        var row = $("<tr>");
        //Iterate for all object properties and create
        //first row with its names.
        for (let i = 0; i < nkeys; i++) {
            var name = keyNames[i];

            //Create column
            var column = $("<th>")
                .append(name)

            //Append column to row
            row.append(column);
            //Check if this property has more elements than previous ones
            if (nElements < obj[name].length) {
                nElements = obj[name].length;
            }
        }
        //Apend row to table
        table.append(row);


        //Iterate for properties elements to create all element rows
        for (let j = 0; j < nElements; j++) {

            var row = $("<tr>");
            for (let i = 0; i < nkeys; i++) {
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

    var listDeployments_button = function () {
        console.log("Creating deployments list button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", listDeployments_button);
            return;
        }
        if ($("#listDeployments_button").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Deployments list",
                    "icon": "fa-list",
                    "handler": toggle_DeploymentList,
                }, "toggle-deployment-list", prefix)
            ]);
        }
    };

    var deploy_button = function () {
        console.log("Creating deploy button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", deploy_button);
            return;
        }
        clearDeployInfo();
        if ($("#deploy_button").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Infrastructure deploy",
                    "icon": "fal fa-sitemap",
                    "handler": toggle_Deploy,
                }, "toggle-deploy", prefix)
            ]);
        }
    };

    //****************//
    //*   Dialogs    *//
    //****************//    

    var create_ListDeployments_dialog = function (show) {

        //Check if kernel is available
        if (typeof Jupyter.notebook.kernel == "undefined" || Jupyter.notebook.kernel == null) {
            events.on("kernel_ready.Kernel", function (evt, data) {
                create_ListDeployments_dialog(show);
            });
            return;
        }
        console.log("Creating deployments list window");

        // Get cluster list 

        var callbacks = {
            iopub: {
                output: function (data) {
                    //Check message
                    var check = checkStream(data)
                    if (check < 0) return; //Not a stream
                    if (check > 0) { //Error message
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

                    for (let i = 5; i < words.length; i += 4) {
                        lists.Name.push(words[i]);
                        lists.State.push(words[i + 1]);
                        lists.IP.push(words[i + 2]);
                        lists.Nodes.push(words[i + 3]);
                    }

                    var table = createTable(lists);

                    //Check if dialog has been already created
                    if ($("#dialog-deployments-list").length == 0) {
                        var listDeployment_dialog = $('<div id="dialog-deployments-list" title="Deployments list">')
                            .append(table)
                        $("body").append(listDeployment_dialog);
                        $("#dialog-deployments-list").dialog();
                    } else {
                        //Clear dialog
                        $("#dialog-deployments-list").empty();

                        //Append dable
                        $("#dialog-deployments-list").append(table)
                        $("#dialog-deployments-list").dialog("open");
                    }
                    if (show == false) {
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


    var create_Deploy_dialog = function () {
        console.log("Creating deploy window");

        var deploy_dialog = $('<div id="dialog-deploy" title="Deploy infrastructure">')

        $("body").append(deploy_dialog);
        $("#dialog-deploy").dialog()

        //Set initial state
        //state_Deploy_Mechanism();
        state_deploy_provider();

        //Close dialog
        $("#dialog-deploy").dialog("close");
    }

    // select provider function
    var state_deploy_provider = function () {

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
                    text: "ONE",
                    click: function () {

                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "OpenNebula") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "one";
                        deployInfo.deploymentType = "OpenNebula";

                        //state_deploy_credentials();
                        state_recipe_type();
                    }
                },
                {
                    text: "EC2",
                    click: function () {

                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "EC2") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "ec2";
                        deployInfo.deploymentType = "EC2";

                        //state_deploy_credentials();
                        state_recipe_type();
                    },
                },
                {
                    text: "OST",
                    click: function () {

                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "OpenStack") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "ost";
                        deployInfo.deploymentType = "OpenStack";

                        //state_deploy_credentials();
                        state_recipe_type();
                    }
                }
            ]);
    }

    // Deploy recipe type
    var state_recipe_type = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Enable shortcuts
        Jupyter.keyboard_manager.enable();

        //Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select recipe type</p>"));

        deployDialog.dialog("option", "buttons", {
            "Back": {
                text: "Back",
                icon: "ui-icon-circle-arrow-w",
                showText: false,
                click: state_deploy_provider
            },
            "Simple-node-disk": function () {
                deployInfo.recipe = "Simple-node-disk";
                applications = ["galaxy", "ansible-tasks", "noderedvm"];
                state_recipe_features();
            },
            "Slurm": function () {
                deployInfo.recipe = "Slurm";
                applications = ["slurm_elastic", "slurm_galaxy", "docker_cluster"];
                state_recipe_features();
            },
            "Kubernetes": function () {
                deployInfo.recipe = "Kubernetes";
                applications = ["kubeapps", "prometheus", "minio", "nodered", "influxdb", "argo"];
                state_recipe_features();
            }
        });

    }

    var state_recipe_features = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Enable shortcuts
        Jupyter.keyboard_manager.enable();

        //Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select recipe optional features</p>"));

        //Create check boxes with optional app
        var ul = $('<ul class="checkbox-grid">');
        for (let i = 0; i < applications.length; i++) {

            //Create line
            let line = $('<li style="white-space:nowrap">'); //Force checkbox and label to stay at same line
            //Create checkbox
            let checkbox = $('<input type="checkbox" id="' + applications[i] + '-appCheckID" name="' + applications[i] + '" value="' + applications[i] + '">');
            //Create label
            let label = $('<label for=" ' + applications[i] + '">');
            label.text(applications[i])

            //Append all to line
            line.append(checkbox);
            line.append(label);

            //Append line to grid
            ul.append(line);
        }

        //Append all to dialog
        deployDialog.append(ul);

        deployDialog.dialog("option", "buttons", {
            "Back": state_recipe_type,
            "Next": function () {
                // Set applications
                var selectedApplications = [];
                for (var i = 0; i < applications.length; i++) {
                    var appId = applications[i] + "-appCheckID";
                    if ($("#" + appId).is(":checked")) {
                        selectedApplications.push(applications[i]);
                    }
                }
                //var selectedApplications = applications.filter(app => $("#" + app + "-appCheckID").is(":checked"));
                deployInfo.apps = selectedApplications;

                state_deploy_credentials();
            }
        });
    }

    // introduce credentials function
    var state_deploy_credentials = function () {

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
        if (deployInfo.deploymentType == "EC2") {
            text1 = "<p>Introduce AWS IAM credentials</p>";
            text2 = "Access Key ID:<br>";
            text3 = "Secret Access Key:<br>";
        }
        else if (deployInfo.deploymentType == "OpenNebula") {
            text1 = "<p>Introduce ONE credentials</p>";
            text2 = "Username:<br>";
            text3 = "Password:<br>";

            //Create host input field
            form.append("Host and port:<br>");
            form.append($('<input id="hostIn" type="text" value="' + deployInfo.host + '" name="host"><br>'));

        }
        else if (deployInfo.deploymentType == "OpenStack") {
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

        deployDialog.dialog("option", "buttons", {
            "Back": function () {
                state_recipe_features();
            },
            "Next": function () {
                if (deployInfo.deploymentType == "OpenNebula") {
                    if (deployInfo.host != $("#hostIn").val()) {
                        //deployInfo.frontend.image = ""
                        //deployInfo.worker.image = ""
                        deployInfo.host = $("#hostIn").val();
                    }
                }
                deployInfo.user = $("#userIn").val();
                deployInfo.credential = $("#userPassIn").val();

                if (deployInfo.deploymentType == "EC2") {
                    state_deploy_EC2_instances();
                }
                else if (deployInfo.deploymentType == "OpenNebula") {
                    state_deploy_vmSpec();
                }
                else if (deployInfo.deploymentType == "OpenStack") {
                    console.log("on construction...");
                    //deployInfo.tenant = $("#tenantIn").val();
                    //state_deploy_OST_frontendSpec();
                }
            }
        });
    }

    // state deploy-EC2-instances
    var state_deploy_EC2_instances = function () {

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
        if (deployInfo.frontend.image.length > 0) {
            var words = deployInfo.frontend.image.split('/');

            if (words.length >= 4) {
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

        if (deployInfo.recipe == "Simple-node-disk") {
            // Port to be opened on AWS
            form.append("Port to be opened in AWS:<br>");
            form.append($('<input id="clusterMaxWorkersIn" type="number" value="1" min="1" name="clusterMaxWorkers"><br>'));
        }

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

        deployDialog.dialog("option", "buttons", {
            "Back": state_deploy_credentials,
            "Next": function () {

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
    var state_deploy_ONE_frontendSpec = function () {

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
        if (imageURL.length == 0) {
            if (deployInfo.deploymentType = "OpenNebula") {
                imageURL = "one://" + deployInfo.host + "/";
            }
        }
        form.append($('<input id="imageUrlIn" type="text" value="' + imageURL + '" name="imageUrl"><br>'));

        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": state_deploy_credentials,
            "Next": function () {
                deployInfo.frontend.CPUs = $("#CPUsIn").val();
                deployInfo.frontend.memory = $("#imageMemIn").val();
                deployInfo.frontend.image = $("#imageUrlIn").val();

                state_deploy_vmSpec();
            }
        });
    }

    //state deploy OST frontendSpec
    var state_deploy_OST_frontendSpec = function () {

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
        if (imageURL.length == 0) {
            if (deployInfo.deploymentType = "OpenStack") {
                imageURL = "one://" + deployInfo.host + "/";
            }
        }
        form.append($('<input id="imageUrlIn" type="text" value="' + imageURL + '" name="imageUrl"><br>'));

        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": state_deploy_credentials,
            "Next": function () {
                deployInfo.frontend.CPUs = $("#CPUsIn").val();
                deployInfo.frontend.memory = $("#imageMemIn").val();
                deployInfo.frontend.image = $("#imageUrlIn").val();

                if ($("#imageUserIn").val().length == 0) {
                    deployInfo.frontend.user = "";
                } else {
                    deployInfo.frontend.user = $("#imageUserIn").val();
                }

                if ($("#imageUserPassIn").val().length == 0) {
                    deployInfo.frontend.credentials = ""
                } else {
                    deployInfo.frontend.credentials = $("#imageUserPassIn").val();
                }


                state_deploy_vmSpec();
            }
        });
    }

    // state deploy-one-worker
    var state_deploy_vmSpec = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        if (deployInfo.recipe != "Simple-node-disk") {
            var workerFormButton = $('<button class="formButton">Worker specifications</button>');
            var feFormButton = $('<button class="formButton">Frontend specifications</button>');
            deployDialog.append(workerFormButton);
            deployDialog.append(feFormButton);

            workerFormButton.click(function () {
                form2.hide();
                form.show();
            });

            feFormButton.click(function () {
                form.hide();
                form2.show();
            });
        }

        //Create form for worker node
        var form = $("<form>")
        form.append($("<p>Introduce worker VM specifications</p>"));

        form.append("Cluster name:<br>");
        form.append($('<input id="clusterName" type="text" value="' + deployInfo.infName + '"><br>'));

        form.append("Number of VMs:<br>");
        form.append($('<input id="clusterWorkers" type="number" value="1" min="1"><br>'));

        form.append("Number of CPUs for each VM:<br>");
        form.append($('<input id="clusterCPUs" type="number" value="1" min="1"><br>'));

        form.append("Memory for each VM (GB):<br>");
        form.append($('<input id="clusterMemory" type="number" value="2" min="2""><br>'));

        form.append("Size of the root disk of the VM(s) (GB):<br>");
        form.append($('<input id="clusterDiskSize" type="number" value="20" min="20"><br>'));

        form.append("Number of GPUs for each VM:<br>");
        form.append($('<input id="clusterGPUs" type="number" value="1" min="1"><br>'));

        //Create form for frontend node
        var form2 = $("<form>");
        form2.append("Introduce frontend VM specifications:<br>");

        form2.append("Number of CPUs for each VM:<br>");
        form2.append($('<input id="FECPUs" type="number" value="1" min="1"><br>'));

        form2.append("Memory for each VM (GB):<br>");
        form2.append($('<input id="FEMemory" type="number" value="2" min="2""><br>'));

        form2.append("Size of the root disk of the VM(s) (GB):<br>");
        form2.append($('<input id="FEDiskSize" type="number" value="20" min="20"><br>'));

        deployDialog.append(form);
        deployDialog.append(form2.hide());


        deployDialog.dialog("option", "buttons", {
            "Back": function () {
                state_deploy_credentials();
            },
            "Next": {
                text: deployInfo.apps.length === 0 ? "Deploy" : "Next",
                click: function () {
                    deployInfo.infName = $("#clusterName").val();
                    deployInfo.worker.instances = $("#clusterWorkers").val();
                    deployInfo.worker.CPUs = $("#clusterCPUs").val();
                    deployInfo.worker.memory = $("#clusterMemory").val();
                    deployInfo.worker.disk = $("#clusterDiskSize").val();
                    deployInfo.worker.GPUs = $("#clusterGPUs").val();

                    if (deployInfo.recipe !== "Simple-node-disk") {
                        deployInfo.frontend.CPUs = $("#FECPUs").val();
                        deployInfo.frontend.memory = $("#FEMemory").val();
                        deployInfo.frontend.disk = $("#FEDiskSize").val();
                    }

                    if (deployInfo.apps.length === 0) {
                        state_deploy_app();
                    } else {
                        state_deploy_features();
                    }
                }
            }
        });
    }

    var state_deploy_features = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        var apps = deployInfo.apps;
        var formGalaxy = $("<form>");
        var formNodeRed = $("<form>");
        var formAnsible = $("<form>");

        apps.forEach(function (app) {
            var appButton = $('<button class="formButton">' + app + '</button>');
            appButton.click(function () {
                var appName = $(this).text().toLowerCase();
                formGalaxy.toggle(appName === 'galaxy');
                formNodeRed.toggle(appName === 'noderedvm');
                formAnsible.toggle(appName === 'ansible-tasks');
            });
            deployDialog.append(appButton);
        });

        //Create form for galaxy
        formGalaxy.append("<p>Galaxy specifications</p>");
        formGalaxy.append("Email of the Galaxy admin user:<br>");
        formGalaxy.append($('<input id="galaxyUsername" type="text" value="admin@admin.com"><br>'));
        formGalaxy.append("Password of the Galaxy admin user:<br>");
        formGalaxy.append($('<input id="galaxyPass" type="password" value="adminpass"><br>'));
        formGalaxy.hide();

        //Create form for Node-RED
        formNodeRed.append("<p>Node-RED specifications</p>");
        formNodeRed.append("Name of the admin user:<br>");
        formNodeRed.append($('<input id="nodeREDUsername" type="text" value="admin"><br>'));
        formNodeRed.append("Password of the full admin user (adminpass). See how to get it https://nodered.org/docs/user-guide/runtime/securing-node-red#generating-the-password-hash<br>");
        formNodeRed.append($('<input id="nodeREDPass" type="password" value="$2b$08$BZqMjl9G.0itJFac/WY3mea/Oq1HCiYO3DGcQ9Uc8pldFdfVN/fvi"><br>'));
        formNodeRed.hide();

        //Create form for MinIO
        formAnsible.append("<p>Ansible specifications</p>");
        formAnsible.append("Ansible tasks (In case of using double quotes you have to escape it with \\):<br>");
        formAnsible.append($('<textarea id="ansibleRecipe"></textarea><br>'));
        formAnsible.append("or specify an URL of a set of Ansible tasks<br>");
        formAnsible.append($('<input id="ansibleURL" type="text"><br>'));
        formAnsible.hide();

        deployDialog.append(formGalaxy);
        deployDialog.append(formNodeRed);
        deployDialog.append(formAnsible);

        // Handle form visibility based on the first app
        var firstApp = apps.length > 0 ? apps[0] : null;
        if (firstApp === 'galaxy') {
            formGalaxy.show();
        } else if (firstApp === 'ansible-tasks') {
            formAnsible.show();
        } else if (firstApp === 'noderedvm') {
            formNodeRed.show();
        }

        deployDialog.dialog("option", "buttons", {
            "Back": state_deploy_vmSpec,
            "Deploy": function () {
                state_deploy_app();
            }
        });
    }

    var state_deploy_app = function () {
        var deployDialog = $("#dialog-deploy");

        // Clear dialog
        deployDialog.empty();

        // Disable shortcuts
        Jupyter.keyboard_manager.disable();

        // Deployment logic
        if (deploying) {
            alert("Previous deploy has not finished.");
            return; // Deploy only one infrastructure at once
        }
        deploying = true;

        // Create kernel callback
        var callbacks = {
            iopub: {
                output: function (data) {
                    // Check message
                    var check = checkStream(data)

                    if (check < 0) {
                        return; // Not a stream
                    }

                    var pubtext = data.content.text.replace("\r", "\n");
                    if (check > 0) { // Error message
                        deploying = false;
                        alert(pubtext);
                        console.log(pubtext)
                        // Call self function to reconstruct dialog
                        state_deploy_app();
                        return;
                    }

                    // Successfully executed
                    deploying = false
                    console.log(pubtext)

                    // Call self function to reconstruct dialog
                    state_deploy_app();
                }
            }
        };

        // Create deploy script
        var cmd = deployIMCommand(deployInfo, templatesURL);

        // Clear dialog
        deployDialog.empty();

        // Show loading spinner
        deployDialog.append($('<div class="loader"></div>'));

        // Remove buttons
        deployDialog.dialog("option", "buttons", {});

        // Deploy using IM
        var Kernel = Jupyter.notebook.kernel;
        Kernel.execute(cmd, callbacks);
    };

    var deployIMCommand = function (obj, templateURL) {

        //Add applications
        // for(let i = 0; i < obj.apps.length; i++){
        //     //Check if is a local or a ec3 application
        //     if(localApplications.indexOf(obj.apps[i]) > -1){		
        // 	cmd += " __local_" + obj.apps[i];
        //     } else{
        // 	cmd += " " + obj.apps[i];
        //     }
        // }

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

        // Copy the contents of an existing template file to the desired location
        cmd += "\n cp $PWD/apricot_plugin/templates/__local_simple-node-disk.yml ~/.imclient/templates/" + imageRADL + ".yml\n";

        cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
            "id = " + obj.id + "; type = " + obj.deploymentType + "; host = " + obj.host + "; username = " + obj.user + "; password = " + obj.credential + ";\" > $PWD/" + pipeAuth + " & \n"
        //Create final command where the output is stored in "imOut"
        cmd += "imOut=\"`python3 /usr/local/bin/im_client.py -a $PWD/" + pipeAuth + " create " + "~/.imclient/templates/" + imageRADL + ".yml -r https://im.egi.eu/im" + " `\" \n";

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

    var checkStream = function (data) {
        if (data.msg_type == "stream") {
            if (data.content.name == "stdout") {
                //Is a stdout message
                return 0;
            } else {
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


    var toggle_DeploymentList = function () {
        if ($("#dialog-deployments-list").dialog("isOpen")) {
            $("#dialog-deployments-list").dialog("close");
        } else {
            create_ListDeployments_dialog(true);
            $("#dialog-deployments-list").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    }


    var toggle_Deploy = function () {
        if ($("#dialog-deploy").dialog("isOpen")) {
            $("#dialog-deploy").dialog("close");
        } else {
            $("#dialog-deploy").dialog("open");
            $("#dialog-deploy").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    }

    //*******************//
    //* Jupyter handler *//
    //*******************//        


    var load_jupyter_extension = function () {
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
