
from __future__ import print_function
from IPython.core.magic import (Magics, magics_class, line_magic,
                                cell_magic, line_cell_magic)
import os, glob
import subprocess
import json
from tabulate import tabulate

@magics_class
class Apricot(Magics):

    actualDir = ""
    oneDataToken = ""
    oneDataHost = ""
    oneDataStore = "/opt/onedata_spaces/"

    ########################
    #  Auxiliar functions  #
    ########################
    
    def splitClear(self, line, pattern=' '):

        if len(line) == 0:
            return []

        return list(filter(len,line.split(pattern)))
    
    def createAuthPipe(self, clusterId):
        # Read the JSON data from the file
        with open('apricot_plugin/clusterList.json') as f:
            data = json.load(f)

        # Find the cluster with the specified ID
        found_cluster = None
        for cluster in data['clusters']:
            if cluster['clusterId'] == clusterId:
                found_cluster = cluster
                break

        if found_cluster is None:
            raise ValueError(f"Cluster with ID {clusterId} does not exist.")

        # Construct auth-pipe content based on cluster type
        auth_content = f"type = InfrastructureManager; username = user; password = pass;\n"

        # Construct additional credentials based on cluster type
        if found_cluster['type'] == "OpenStack":
            auth_content += f"id = {found_cluster['id']}; type = {found_cluster['type']}; username = {found_cluster['user']}; password = {found_cluster['pass']}; host = {found_cluster['host']}; tenant = {found_cluster['tenant']}"
        elif found_cluster['type'] == "OpenNebula":
            auth_content += f"id = {found_cluster['id']}; type = {found_cluster['type']}; username = {found_cluster['user']}; password = {found_cluster['pass']}; host = {found_cluster['host']}"
        elif found_cluster['type'] == "AWS":
            auth_content += f"id = {found_cluster['id']}; type = {found_cluster['type']}; username = {found_cluster['user']}; password = {found_cluster['pass']}; host = {found_cluster['host']}"

        # Write auth-pipe content to a file
        with open('auth-pipe', 'w') as auth_file:
            auth_file.write(auth_content)

        return

    def generateKey(self, state_lines):
        # Initialize variables to store the private key content and host IP
        private_key_content = None
        hostIP = None

        # Iterate over each line in the state output
        private_key_started = False
        for line in state_lines:
            # Check if the line contains the private key information
            if line.strip().startswith("disk.0.os.credentials.private_key ="):
                private_key_started = True
                private_key_content = line.split(" = ")[1].strip().strip("'") + '\n'
                continue

            # If private key capture has started, capture lines until END RSA PRIVATE KEY
            if private_key_started:
                private_key_content += line + '\n'

            # Check if the line contains the end of the private key
            if "END RSA PRIVATE KEY" in line:
                private_key_started = False

            if line.strip().startswith("net_interface.1.ip ="):
                # Extract the host IP
                hostIP = line.split("'")[1].strip()
                break

        # Check if private key content is found
        if private_key_content:
            # Write private key content to a file named key.pem
            with open("key.pem", "w") as key_file:
                key_file.write(private_key_content)

            # Change permissions of key.pem to 600
            os.chmod("key.pem", 0o600)

        return private_key_content, hostIP

    ##################
    #     Magics     #
    ##################

    @line_magic
    def apricot_log(self, line):
        if len(line) == 0:
            print("Usage: apricot_log infID\n")
            return "Fail"

        # Split line
        words = self.splitClear(line)

        # Get cluster ID
        infID = words[0]

        try:
            # Call createAuthPipe method
            self.createAuthPipe(infID)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call im_client.py to get log
        pipes = subprocess.Popen(["python3", "/usr/local/bin/im_client.py", "getcontmsg", "-a", "auth-pipe", "-r", "https://im.egi.eu/im", infID], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            #Send output to notebook
            print( std_out )

        else:
            #Send error and output to notebook
            print( "Status: fail " + str(pipes.returncode) + "\n")
            print( std_err + "\n")
            print( std_out )
            return "Fail"

        # Check if the file exists and remove it
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')

        return

    @line_magic
    def apricot_ls(self, line):
        # Read the JSON data from the file
        with open('apricot_plugin/clusterList.json') as f:
            data = json.load(f)

        # Initialize clusters list
        clusters = []

        # Iterate through each cluster
        for cluster in data['clusters']:
            cluster_info = {
                'Name': cluster['name'],
                'Cluster ID': cluster['clusterId'],
                'IP': "",
                'State': ""
            }

            try:
                # Call createAuthPipe method
                self.createAuthPipe(cluster['clusterId'])
            except ValueError as e:
                print(e)
                return "Failed"

            # Call im_client.py to get state
            cmdState = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getstate',
                cluster['clusterId'],
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            # Execute command and capture output
            try:
                state_output = subprocess.check_output(cmdState, universal_newlines=True)
                # Process state output to extract state information
                state_words = state_output.split()
                state_index = state_words.index("state:") if "state:" in state_words else -1
                if state_index != -1 and state_index < len(state_words) - 1:
                    state = state_words[state_index + 1].strip()
                    cluster_info['State'] = state
                else:
                    cluster_info['State'] = "Error: State not found"
            except subprocess.CalledProcessError as e:
                cluster_info['State'] = f"Error: {e.output.strip()}"

            # Call im_client.py to get vm info
            cmdIP = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getvminfo',
                cluster['clusterId'],
                '0',
                'net_interface.1.ip',
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            # Execute command and capture output
            try:
                ip_output = subprocess.check_output(cmdIP, universal_newlines=True)
                # Process output to extract IP information
                # Check if the output contains an error message
                if "error" in ip_output.lower():
                    ip = "Error: " + ip_output.strip()
                else:
                    # Extract IP address from the output
                    ip = ip_output.split()[-1].strip()
                cluster_info['IP'] = ip
            except subprocess.CalledProcessError as e:
                cluster_info['IP'] = f"Error: {e.output.strip()}"

            clusters.append(cluster_info)

        # Convert clusters to a list of lists for tabulate
        cluster_data = [[cluster['Name'], cluster['Cluster ID'], cluster['IP'], cluster['State']] for cluster in clusters]

        # Print the information as a table using tabulate
        print(tabulate(cluster_data, headers=['Name', 'Cluster ID', 'IP', 'State'], tablefmt='grid'))
        
        # Check if the file exists and remove it
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')

        return

    @line_magic
    def apricot_nodels(self, line):
        if len(line) == 0:
            print("Usage: nodels clusterID\n")
            return "Fail"

        # Split line
        words = self.splitClear(line)

        # Get cluster ID
        infID = words[0]

        try:
            # Call createAuthPipe method
            self.createAuthPipe(infID)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call im_client.py to get state
        cmd = [
            'python3',
            '/usr/local/bin/im_client.py',
            'getinfo',
            infID,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        # Initialize a list to store VM information
        vm_info_list = []

        current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None
        
        # Execute command and capture output
        state_output = subprocess.check_output(cmd, universal_newlines=True)

        # Split the output by lines
        state_lines = state_output.split('\n')

        try:
            for line in state_lines:
                if all((current_vm_id, ip_address, status, provider_type, os_image)):
                    vm_info_list.append([current_vm_id, ip_address, status, provider_type, os_image])
                    current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None
                
                else:
                    if line.startswith("Info about VM with ID:"):
                        current_vm_id = line.split(":")[1].strip()
                    if line.strip().startswith("net_interface.1.ip ="):
                        ip_address = line.split("'")[1].strip()
                    if line.strip().startswith("state ="):
                        status = line.split("'")[1].strip()
                    if line.strip().startswith("provider.type ="):
                        provider_type = line.split("'")[1].strip()
                    if line.strip().startswith("disk.0.image.url ="):
                        os_image = line.split("'")[1].strip()

            if all((current_vm_id, ip_address, status, provider_type, os_image)):
                vm_info_list.append([current_vm_id, ip_address, status, provider_type, os_image])

        except subprocess.CalledProcessError as e:
            print(f"Error: {e.output.strip()}")

        # Print the information as a table using tabulate
        print(tabulate(vm_info_list, headers=['VM ID', 'IP Address', 'Status', 'Provider', 'OS Image'], tablefmt='grid'))
        
        # Clean up auth-pipe file after processing
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        
        return

    # @line_magic
    # def apricot_onedata(self,line):
    #     if len(line) == 0:
    #         print("usage: apricot_onedata clustername instruction parameters...\n")
    #         print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
    #         return "fail"

    #     #Split line
    #     words = self.splitClear(line)
    #     if len(words) < 2:
    #         print("usage: apricot_onedata clustername instruction parameters...\n")
    #         print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
    #         return "fail"

    #     #Get cluster name
    #     clusterName = words[0]

    #     #Get instruction
    #     instruction = words[1]

    #     if instruction == "set-token":
    #         if len(words) < 3:
    #             print("No token specified")
    #             return "fail"
    #         oneDataToken = words[3]
    #     elif instruction == "get-token":
    #         return oneDataToken
    #     elif instruction == "set-host":
    #         if len(words) < 3:
    #             print("No host specified")
    #             return "fail"
    #         oneDataHost = words[3]
    #     elif instruction == "get-host":
    #         return oneDataHost
    #     elif instruction == "mount":

    #         if len(words) < 3:
    #             print("No mount point specified")
    #             return "fail"

    #         #Create directory to mount specified space
    #         if words[2][0] == '/':
    #             mountPoint = words[2]                
    #         else:
    #             mountPoint = self.oneDataStore + words[2]

    #         self.apricot("exec " + clusterName + " rm -r " + mountPoint + "&> /dev/null")
    #         status = self.apricot("exec " + clusterName + " mkdir " + mountPoint)
    #         if status != "done":
    #             print("Unable to create directory: " + mountPoint)
    #             return "fail"
                
            
    #         if len(words) < 4:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + oneDataHost + " -t " + oneDataToken + " " + mountPoint)
    #         if len(words) < 5:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + oneDataToken + " " + mountPoint)
    #         else:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + words[4] + " " + mountPoint)

    #     elif instruction == "umount":
    #         if len(words) < 3:
    #             print("No mount point specified")
    #             return "fail"
    #         return self.apricot("exec " + clusterName + " oneclient -u " + words[2])

    #     elif instruction == "download" or instruction == "upload":
    #         if len(words) < 4:
    #             print("usage: apricot_onedata clusterName cp onedataPath localPath")
    #             return "fail"

            
    #         if instruction == "download":
    #             origin = self.oneDataStore + words[2]
    #             destin = words[3]
    #         else:
    #             origin = words[2]
    #             destin = self.oneDataStore + words[3]
                
    #         #Try to copy file from/to already mounted space
    #         status = self.apricot("exec " + clusterName + " cp " + origin + " " + destin)

    #         if status != "done":
    #             return "fail"                
    #         else:
    #             return "done"
        
    #     else:
    #         print("Unknown instruction")
    #         return "fail"

    # @line_magic
    # def apricot_runOn(self, line):
    #     if len(line) == 0:
    #         return "fail"
    #     words = self.splitClear(line)
    #     if len(words) < 3:
    #         print("usage: apricot_runOnAll clustername node-list command")
    #         return "fail"
            
    #     #Get cluster name
    #     clusterName = words[0]
    #     nodeList = words[1]
    #     command = ' '.join(words[2:])
    
    #     return self.apricot("exec " + clusterName + " srun -w " + nodeList + " " + command)

    # @line_magic
    # def apricot_MPI(self,line):

        if len(line) == 0:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"

        #Split line
        words = self.splitClear(line)
        
        if len(words) < 5:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"
        

        #Get cluster name
        clusterName = words[0]

        #Get number of nodes to use
        nodes2use = int(words[1])
        if nodes2use <= 0:
            print("Invalid node number")
            return "fail"

        #Get number of tasks to execute
        ntasks = int(words[2])
        if ntasks <= 0:
            print("Invalid task number")
            return "fail"
        
        #Get execution path
        execPath = words[3]        
        
        #Get program path
        executablePath = words[4]
        
        #Get arguments
        arguments = ""
        if len(line) > 5:
            for word in words[5:]:
                arguments += word
        
        command = "exec " + clusterName + " cd " + execPath + " && salloc -N " + str(nodes2use) + " mpirun -n " + str(ntasks) + " --mca btl_base_warn_component_unused 0 " + executablePath + " " + arguments
        if self.apricot(command) != "done":
            return "fail"        
        return "done"
   
    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0:
            print("Usage: upload clusterId file1 file2 ... fileN remote-destination-path\n")
            return "fail"
        words = self.splitClear(line)
        if len(words) < 3:
            print("Usage: upload clusterId file1 file2 ... fileN remote-destination-path\n")
            return "fail"

        # Get cluster id
        clusterId = words[0]
        destination = words[len(words) - 1]
        files = words[1:-1]

        try:
            # Call createAuthPipe method
            self.createAuthPipe(clusterId)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call im_client.py to get state
        cmd = [
            'python3',
            '/usr/local/bin/im_client.py',
            'getinfo',
            clusterId,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        # Execute command and capture output
        state_output = subprocess.check_output(cmd, universal_newlines=True)

        # Split the output by lines
        state_lines = state_output.split('\n')

        # Call createKey function to extract private key content and host IP
        private_key_content, hostIP = self.generateKey(state_lines)

        if private_key_content:
            # Initialize the SCP command
            cmd2 = ['scp', '-i', 'key.pem']

        # Add each file to the SCP command
        for file in files:
            cmd2.extend([file])

        # Add the destination path to the SCP command
        cmd2.append(f'root@{hostIP}:{destination}')

        # Execute SCP command
        pipes = subprocess.Popen(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            #Send output to notebook
            print( std_out )

        else:
            #Send error and output to notebook
            print( std_err + "\n")
            print( std_out )

        # Check if the files exist and remove them
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"
            
    @line_magic
    def apricot_download(self, line):
        if len(line) == 0:
            print("Usage: download clusterId file1 file2 ... fileN local-destination-path\n")
            return "Fail"
        words = self.splitClear(line)
        if len(words) < 3:
            print("Usage: download clusterId file1 file2 ... fileN local-destination-path\n")
            return "Fail"

        # Get cluster id
        clusterId = words[0]
        destination = words[len(words) - 1]
        files = words[1:-1]

        try:
            # Call createAuthPipe method
            self.createAuthPipe(clusterId)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call im_client.py to get state
        cmd = [
            'python3',
            '/usr/local/bin/im_client.py',
            'getinfo',
            clusterId,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        # Execute command and capture output
        state_output = subprocess.check_output(cmd, universal_newlines=True)

        # Split the output by lines
        state_lines = state_output.split('\n')

        # Call createKey function to extract private key content and host IP
        private_key_content, hostIP = self.generateKey(state_lines)

        if private_key_content:
            # Initialize the SCP command
            cmd2 = ['scp', '-i', 'key.pem']

        # Add each file to the SCP command
        for file in files:
            cmd2.extend(['root@' + hostIP + ':' + file])

        # Add the destination path to the SCP command
        cmd2.append(destination)

        # Execute SCP command
        pipes = subprocess.Popen(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            #Send output to notebook
            print(std_out)
        else:
            #Send error and output to notebook
            print( std_err + "\n")

        # Check if the files exist and remove them
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"
            
    @line_cell_magic
    def apricot(self, code, cell=None):
        #Check if is a cell call
        if cell != None:
            lines = self.splitClear(cell,'\n')
            for line in lines:
                if len(line) > 0:
                    if self.apricot(line, None) != "Done":
                        print("Execution stopped")
                        return ("Fail on line: '" + line + "'")
            return "Done"

        if len(code) == 0:
            return "Fail"
        words = self.splitClear(code)
        #Get first word
        word1 = words[0]
        #Get user command
        userCMD = ""
        if len(words) > 1:
            userCMD = " ".join(words[1:])
        if word1 == "exec" or word1 == "execAsync":
                
            if len(words) < 3:
                print("Incomplete instruction: " + "'" + code + "' \n 'exec' format is: 'exec cluster-id vm-id instruction'" )
                return "Fail"
            else:
                #Get cluster ID
                clusterId = words[1]

                #Get VM ID
                vmId = words[2]
                
                #Get command to execute at cluster
                clusterCMD = words[3:]

                try:
                    # Call createAuthPipe method
                    self.createAuthPipe(clusterId)
                except ValueError as e:
                    print(e)
                    return "Failed"

                # Call im_client.py to get state
                cmdState = [
                    'python3',
                    '/usr/local/bin/im_client.py',
                    'getinfo',
                    clusterId,
                    '-r',
                    'https://im.egi.eu/im',
                    '-a',
                    'auth-pipe',
                ]

                # Execute command and capture output
                state_output = subprocess.check_output(cmdState, universal_newlines=True)

                # Split the output by lines
                state_lines = state_output.split('\n')

                # Call createKey function to extract private key content and host IP
                private_key_content, hostIP = self.generateKey(state_lines)

                if private_key_content:
                    # Initialize the SSH command
                    ssh_cmd = ['ssh', '-i', 'key.pem', 'root@' + hostIP] + clusterCMD

                    # Execute SSH command
                    pipes = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                    # Capture the output and error of the command
                    ssh_instruct, std_err = pipes.communicate()
                    ssh_instruct = ssh_instruct.decode("utf-8")
                    std_err = std_err.decode("utf-8")

                    if pipes.returncode == 0:
                        # Send instruction
                        split_result = self.splitClear(ssh_instruct, "\n")
                        if split_result:
                            ssh_instruct = split_result[0]
                        else:
                            ssh_instruct = ""

                        split_result = self.splitClear(ssh_instruct)
                        if split_result:
                            ssh_instruct = split_result
                        else:
                            ssh_instruct = []

                        pipes = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                        #Check if the call is asyncronous
                        if word1 == "execAsync":
                            return pipes
                    
                        std_out, std_err = pipes.communicate()
                        std_out = std_out.decode("utf-8")
                        std_err = std_err.decode("utf-8")

                        print(std_out)

                        # Check if the files exist and remove them
                        if os.path.exists('auth-pipe'):
                            os.remove('auth-pipe')
                        if os.path.exists('key.pem'):
                            os.remove('key.pem')

                        return "Done"
                    else:
                        #Send error and output to notebook
                        print( "Status: fail " + str(pipes.returncode) + "\n")
                        print( std_err + "\n")
                        print( std_out )

                        # Check if the files exist and remove them
                        if os.path.exists('auth-pipe'):
                            os.remove('auth-pipe')
                        if os.path.exists('key.pem'):
                            os.remove('key.pem')

                        return "Fail"
                else:
                    #Send error to notebook
                    print( "Status: fail " + str(pipes.returncode) + "\n")
                    print( std_err + "\n" + ssh_instruct)
                    print( "\nCheck if cluster ID '" + clusterId + "' exists\n" )
                    return "Fail"
                
        elif word1 == "list":
            self.apricot_ls(code)

        elif word1 == "destroy":
            if len(words) != 2:  # Check if only one argument is provided (the cluster ID)
                print("Usage: destroy clusterId")
                return "Fail"
            else:
                clusterId = words[1]  # Use the provided cluster ID directly

                try:
                    # Call createAuthPipe method
                    self.createAuthPipe(clusterId)
                except ValueError as e:
                    print(e)
                    return "Failed"

                destroyCMD = [
                    'python3',
                    '/usr/local/bin/im_client.py',
                    'destroy',
                    clusterId,
                    '-r',
                    'https://im.egi.eu/im',
                    '-a',
                    'auth-pipe',
                ]

                # Execute command and capture output
                process = subprocess.Popen(destroyCMD, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                print("Destroying...\nPlease wait, this may take a few seconds.", end='', flush=True)

                log, std_err = process.communicate()
                log = log.decode('utf-8')
                std_err = std_err.decode('utf-8')

                # Clear the message
                print("\r" + " " * len("Destroying...\nPlease wait, this may take a few seconds."), end='', flush=True)

                if log:
                    print(log)
                if std_err:
                    print(std_err)

                # Load cluster list from JSON file
                with open('apricot_plugin/clusterList.json', 'r') as f:
                    data = json.load(f)

                # Find and remove the cluster with the specified ID
                for cluster in data['clusters']:
                    if cluster['clusterId'] == clusterId:
                        data['clusters'].remove(cluster)
                        break

                # Write the updated cluster list back to the JSON file
                with open('apricot_plugin/clusterList.json', 'w') as f:
                    json.dump(data, f, indent=4)

                # Check if the file exists and remove it
                if os.path.exists('auth-pipe'):
                    os.remove('auth-pipe')

                return "Done"
        
        return


def load_ipython_extension(ipython):
    ipython.register_magics(Apricot)
